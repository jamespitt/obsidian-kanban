// Pure task-line parsing/editing logic, with no dependency on the Obsidian
// API - deliberately kept separate from view.ts (which does the vault I/O)
// so it stays easily unit-testable, and so it stays an obvious mirror of
// pkg/tasks/tasks.go in the notesmd-cli server and api.ts in task-front-end.
// All three implement the same markdown conventions independently; this file
// is the Obsidian-plugin one.

export type TaskStatus = 'todo' | 'completed';

export interface Task {
    filePath: string;
    lineNum: number; // 1-based
    title: string;
    status: TaskStatus;
    due?: string;
    scheduled?: string;
    priority?: string;
    repeat?: string;
    tags: string[];
    listName: string; // file stem, e.g. "Work.md" -> "Work"
    source?: string;
    user?: string;
    created?: string;
    /** Descendants, in file order. `level` is relative to the card (1 = direct child). */
    subtasks?: Subtask[];
    /** Indent depth (0 = top level). Set by the local scan and by the server. */
    level?: number;
    /** Local scan only: line number of the nearest ancestor task in the same file. */
    parentLine?: number;
}

export interface Subtask {
    title: string;
    checked: boolean;
    level?: number;
    /** Line in the card's file, so a subtask can be acted on (e.g. made top level). */
    lineNum?: number;
}

// The mutually-exclusive tags used when a board doesn't specify its
// own custom columns (see parseBoardColumns below) - matches KanbanTags/
// KANBAN_STATUSES in pkg/tasks and api.ts exactly, which is what keeps a
// default board's columns showing the same set of tasks as task-front-end's
// Kanban tab and task_viewer.py's Kanban view. A board with custom columns
// necessarily diverges from those two, since they only know this fixed set.
export const KANBAN_STATUSES = ['ToDo', 'InProgress', 'Done', 'Delete'] as const;
// Any tag name can be a column once boards can define their own, so this is
// just a readability alias now, not a closed union.
export type KanbanStatus = string;

const TASK_LINE_RE = /^(\s*)-\s*\[([xX ])\]\s+(.*)$/;
const DATAVIEW_RE = /\[([^\]]+?)::([^\]]*)\]/g;
const TAG_RE = /#([\w/]+)/g;
const CREATED_RE = /\[created\s*::?\s*([^\]]+)\]/gi;

/** Parses a single line into a Task, or null if it isn't a task checkbox. */
export function parseTaskLine(line: string, filePath: string, lineNum: number): Task | null {
    const m = TASK_LINE_RE.exec(line);
    if (!m) return null;

    const [, , statusChar, rawBody] = m;
    const status: TaskStatus = statusChar?.toLowerCase() === 'x' ? 'completed' : 'todo';

    const fields: Record<string, string> = {};
    for (const fm of (rawBody ?? '').matchAll(DATAVIEW_RE)) {
        const key = (fm[1] ?? '').trim().toLowerCase();
        const value = (fm[2] ?? '').trim();
        fields[key] = value;
    }

    const createdMatch = /\[created\s*::?\s*([^\]]+)\]/i.exec(rawBody ?? '');
    const created = createdMatch ? createdMatch[1]?.trim() : undefined;

    const tags: string[] = [];
    for (const tm of (rawBody ?? '').matchAll(TAG_RE)) {
        if (tm[1]) tags.push(tm[1]);
    }

    const title = (rawBody ?? '')
        .replace(DATAVIEW_RE, '')
        .replace(CREATED_RE, '')
        .replace(TAG_RE, '')
        .trim();

    const listName = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;

    return {
        filePath,
        lineNum,
        title,
        status,
        due: fields.due,
        scheduled: fields.scheduled,
        priority: fields.priority,
        repeat: fields.repeat,
        tags,
        listName,
        source: fields.source,
        user: fields.user,
        created: created || fields.created
    };
}

/**
 * A task's current column, or null if it carries none of `columns`' tags.
 * Defaults to KANBAN_STATUSES, the fixed To Do/In Progress/Done set, for
 * boards that don't define their own columns.
 */
export function kanbanStatus(task: Task, columns: readonly string[] = KANBAN_STATUSES): KanbanStatus | null {
    const tagsLower = new Set(task.tags.map((t) => t.toLowerCase()));
    for (const column of columns) {
        if (tagsLower.has(column.toLowerCase())) return column;
    }
    return null;
}

/** Tasks carrying one of `columns`' tags, regardless of completion status. */
export function filterKanban(tasks: Task[], columns: readonly string[] = KANBAN_STATUSES): Task[] {
    return tasks.filter((t) => kanbanStatus(t, columns) !== null);
}

/**
 * Turns the flat task list into board cards, folding subtasks into their
 * parent - the same rule as the server's KanbanCardsIn (pkg/tasks/subtasks.go):
 * a task with an on-board ancestor isn't a card, it is one of the topmost
 * on-board ancestor's `subtasks`; a task whose ancestors are all off the board
 * stays a card. Tasks without `parentLine` (e.g. cards the server already
 * folded) pass through untouched.
 */
export function foldSubtasks(tasks: Task[], columns: readonly string[] = KANBAN_STATUSES): Task[] {
    const key = (t: { filePath: string; lineNum: number }) => `${t.filePath}:${t.lineNum}`;
    const byKey = new Map(tasks.map((t) => [key(t), t] as const));
    const onBoard = (t: Task) => kanbanStatus(t, columns) !== null;

    const ownerOf = (t: Task): Task | null => {
        let owner: Task | null = null;
        const seen = new Set<string>([key(t)]);
        let parentLine = t.parentLine;
        while (parentLine !== undefined) {
            const pk = `${t.filePath}:${parentLine}`;
            const parent = byKey.get(pk);
            if (!parent || seen.has(pk)) break;
            seen.add(pk);
            if (onBoard(parent)) owner = parent;
            parentLine = parent.parentLine;
        }
        return owner;
    };

    const subs = new Map<string, Subtask[]>();
    const cards: Task[] = [];
    for (const t of tasks) {
        const owner = ownerOf(t);
        if (owner) {
            const list = subs.get(key(owner)) ?? [];
            list.push({ title: t.title, checked: t.status === 'completed', level: (t.level ?? 0) - (owner.level ?? 0), lineNum: t.lineNum });
            subs.set(key(owner), list);
        } else if (onBoard(t)) {
            cards.push(t);
        }
    }
    return cards.map((c) => (subs.has(key(c)) ? { ...c, subtasks: subs.get(key(c)) } : c));
}

/** Done/total over a card's subtasks, or null when it has none. */
export function subtaskProgress(task: Task): { done: number; total: number } | null {
    const subs = task.subtasks ?? [];
    if (subs.length === 0) return null;
    return { done: subs.filter((s) => s.checked).length, total: subs.length };
}

/** True if two column lists are the same set, in the same order, case-insensitively. */
export function sameColumns(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i]?.toLowerCase());
}

/**
 * A human-readable label for a column tag, splitting camelCase/underscore
 * boundaries and capitalizing the first letter - "ToDo" -> "To Do",
 * "InProgress" -> "In Progress", "code_review" -> "Code review". Applies
 * equally to the default columns (reproducing their existing labels) and
 * to any custom column a board defines, so there's one rule for both.
 */
export function columnLabel(tag: string): string {
    const spaced = tag.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * True if `task` should appear on a board scoped by `filterTags` - an empty
 * filter (the default, unscoped board) matches everything; otherwise the
 * task must carry at least one of the given tags (case-insensitive,
 * leading '#' optional on either side).
 */
export function matchesFilter(task: Task, filterTags: string[]): boolean {
    if (filterTags.length === 0) return true;
    const taskTags = new Set(task.tags.map((t) => t.toLowerCase()));
    return filterTags.some((f) => taskTags.has(f.replace(/^#/, '').toLowerCase()));
}

const FILTER_LINE_RE = /^\s*filter\s*:\s*(.*)$/i;
const COLUMNS_LINE_RE = /^\s*columns\s*:\s*(.*)$/i;

function parseTagListLine(content: string, re: RegExp): string[] {
    for (const line of content.split('\n')) {
        const m = re.exec(line);
        if (m) {
            return (m[1] ?? '')
                .split(',')
                .map((t) => t.trim().replace(/^#/, ''))
                .filter((t) => t.length > 0);
        }
    }
    return [];
}

/**
 * A board file's content is just its tag filter and column list, not task
 * data - tasks always live in the real vault files. Parses that filter back
 * out of the saved content: the first "filter: a, b, c" line found,
 * comma-separated, '#' optional per-tag. No such line, or a blank one (a
 * fresh board), means no filter - show every task in scope.
 */
export function parseBoardFilter(content: string): string[] {
    return parseTagListLine(content, FILTER_LINE_RE);
}

/**
 * Parses a board's own column list from its "columns: a, b, c" line, same
 * format as parseBoardFilter. No such line, or a blank one, means the board
 * uses the default To Do/In Progress/Done columns (KANBAN_STATUSES) - so a
 * plain board created before per-board columns existed keeps working
 * exactly as before, and stays in sync with task-front-end/task_viewer.py.
 */
export function parseBoardColumns(content: string): string[] {
    const columns = parseTagListLine(content, COLUMNS_LINE_RE);
    return columns.length > 0 ? columns : [...KANBAN_STATUSES];
}

/** Inverse of parseBoardFilter/parseBoardColumns - the content written back to a board file. */
export function serializeBoardConfig(filterTags: string[], columns: string[]): string {
    const usingDefaultColumns = columns.length === 0;
    const filterDesc = filterTags.length > 0
        ? `tasks tagged ${filterTags.map((t) => `#${t}`).join(', ')}`
        : 'every task in scope';
    const columnsDesc = usingDefaultColumns
        ? `the default columns (${KANBAN_STATUSES.map((c) => `#${c}`).join(' / ')})`
        : `columns ${columns.map((c) => `#${c}`).join(' / ')}`;
    const desc = `Showing ${filterDesc}, with ${columnsDesc}.`;
    return `%% Kanban board - ${desc} Edit the lines below (comma-separated tags; blank filter = show everything, blank columns = default To Do/In Progress/Done) and re-open the board to apply changes. %%\nfilter: ${filterTags.join(', ')}\ncolumns: ${columns.join(', ')}\n`;
}

/**
 * Given the raw text of a file and the 1-based line number of a task within
 * it, returns the file with that task's column tag replaced by `status`
 * (pass null to remove it without adding a new one) - stripping whichever
 * of `columns` (defaults to KANBAN_STATUSES) the task currently carries,
 * not just the fixed three, so this works for a board's own custom column
 * set too. The checkbox is synced to match: moving onto a column literally
 * named "Done" (case-insensitive, wherever it sits in the list) checks the
 * task off; moving onto anything else - or clearing the column entirely -
 * un-checks it. A custom column set with no "Done" in it therefore never
 * auto-completes a task; that's left for the user to manage some other
 * way. Every other tag and [key::value] field is left untouched. Returns
 * the original content unchanged if lineNum doesn't point at a task line
 * (out of range, or not a checkbox).
 */
export function setStatusTagInContent(
    content: string,
    lineNum: number,
    status: KanbanStatus | null,
    columns: readonly string[] = KANBAN_STATUSES
): string {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) return content;

    const line = lines[idx];
    if (line === undefined) return content;
    const m = TASK_LINE_RE.exec(line);
    if (!m) return content;

    const [, indent, , rawBody] = m;
    let raw = rawBody ?? '';
    for (const kt of columns) {
        raw = raw.replace(new RegExp(`#${kt}\\b`, 'gi'), '');
    }
    raw = raw.trim();
    if (status) raw = `${raw} #${status}`.trim();

    const checkbox = status?.toLowerCase() === 'done' ? 'x' : ' ';
    lines[idx] = `${indent ?? ''}- [${checkbox}] ${raw}`;
    return lines.join('\n');
}

/**
 * The in-memory twin of setStatusTagInContent, for an optimistic UI update
 * before a server round-trip (in API mode) confirms it - same rules, applied
 * to a Task's `tags` array instead of raw file text: strips whichever of
 * `columns` the task currently carries, adds `status` (or clears the column
 * entirely for null), and syncs `status`'s completion the same way - a
 * column literally named "Done" (any case) checks it off, anything else
 * un-checks it. Returns a new Task; every other field is left untouched.
 */
export function applyKanbanStatus(task: Task, status: KanbanStatus | null, columns: readonly string[] = KANBAN_STATUSES): Task {
    const columnsLower = new Set(columns.map((c) => c.toLowerCase()));
    const tags = task.tags.filter((t) => !columnsLower.has(t.toLowerCase()));
    if (status) tags.push(status);
    return {
        ...task,
        tags,
        status: status?.toLowerCase() === 'done' ? 'completed' : 'todo'
    };
}

/** Characters not safe to use in an Obsidian note filename. */
const UNSAFE_FILENAME_RE = /[\\/:"*?<>|#[\]]/g;

/** Derives a safe, reasonably short note title from a task's title text. */
export function noteTitleFromTask(taskTitle: string): string {
    const cleaned = taskTitle.replace(UNSAFE_FILENAME_RE, '').trim();
    const truncated = cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
    return truncated || 'Untitled note';
}

/** Extracts the first `[[Note Title]]` link from a task's title, if any - same as task-front-end's extractWikilink. */
export function extractWikilink(title: string): string | null {
    const m = /\[\[([^\]]+)\]\]/.exec(title);
    return m?.[1] ?? null;
}

// Non-global copies of TAG_RE/DATAVIEW_RE for single-match lookups below -
// deliberately not reusing the module-level `g`-flagged ones, since calling
// .exec() on those directly would mutate their shared lastIndex.
const FIRST_TAG_RE = /#([\w/]+)/;
const FIRST_DATAVIEW_RE = /\[([^\]]+?)::([^\]]*)\]/;

/**
 * Inserts a `[[noteTitle]]` link into a task line's title text (right after
 * the title, before any #tags or [key::value] fields) - matching the
 * existing "Title   [[Project Note]] #tag [field::value]" convention
 * already used throughout the vault to link a task to its project note.
 * Returns the content unchanged if lineNum doesn't point at a task line.
 */
export function addNoteLinkToContent(content: string, lineNum: number, noteTitle: string): string {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) return content;

    const line = lines[idx];
    if (line === undefined) return content;
    const m = TASK_LINE_RE.exec(line);
    if (!m) return content;

    const [, indent, statusChar, rawBody] = m;
    const raw = rawBody ?? '';

    const tagIdx = FIRST_TAG_RE.exec(raw)?.index;
    const fieldIdx = FIRST_DATAVIEW_RE.exec(raw)?.index;
    const candidates = [tagIdx, fieldIdx].filter((n): n is number => n !== undefined);
    const splitAt = candidates.length > 0 ? Math.min(...candidates) : raw.length;

    const titlePart = raw.slice(0, splitAt).trimEnd();
    const restPart = raw.slice(splitAt).trim();

    const newRaw = restPart
        ? `${titlePart}   [[${noteTitle}]] ${restPart}`
        : `${titlePart}   [[${noteTitle}]]`;
    lines[idx] = `${indent ?? ''}- [${statusChar}] ${newRaw}`;
    return lines.join('\n');
}

/** The fields a card lets you edit in place (each is a `[key::value]` on the task line). */
export type EditableField = 'due' | 'scheduled' | 'priority' | 'repeat';

export const PRIORITIES = ['high', 'medium', 'low'] as const;

/** `2026-03-27T09:30` / `2026-03-27 09:30` / `2026-03-27` -> its date and time parts. */
export function splitScheduled(value: string): { date: string; time: string } {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec((value || '').trim());
    return { date: m?.[1] ?? '', time: m?.[2] ?? '' };
}

/** The inverse: a date with an optional time, or '' when there is no date. */
export function joinScheduled(date: string, time: string): string {
    if (!date) return '';
    return time ? `${date}T${time}` : date;
}

/**
 * Sets, updates, or removes a `[key::value]` field on a task line. A null or
 * empty `value` removes it. Returns the modified content, preserving all other
 * fields and spacing.
 */
export function setFieldInContent(content: string, lineNum: number, key: EditableField, value: string | null): string {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) return content;

    const line = lines[idx];
    if (line === undefined) return content;
    const m = TASK_LINE_RE.exec(line);
    if (!m) return content;

    const [, indent, statusChar, rawBody] = m;
    let raw = rawBody ?? '';

    const fieldRe = new RegExp(`\\[${key}\\s*::\\s*[^\\]]*\\]`, 'i');
    const withLeadingSpaceRe = new RegExp(`\\s*\\[${key}\\s*::\\s*[^\\]]*\\]`, 'i');
    if (fieldRe.test(raw)) {
        raw = value
            ? raw.replace(fieldRe, `[${key}::${value}]`)
            : raw.replace(withLeadingSpaceRe, '').trim();
    } else if (value) {
        raw = `${raw} [${key}::${value}]`.trim();
    }

    lines[idx] = `${indent ?? ''}- [${statusChar}] ${raw}`;
    return lines.join('\n');
}

/** Sets, updates, or removes the `due::YYYY-MM-DD` field in a task line. */
export function setDueDateInContent(content: string, lineNum: number, due: string | null): string {
    return setFieldInContent(content, lineNum, 'due', due);
}

/**
 * Inserts a subtask checklist item indented one level deeper directly below the parent task.
 * Returns the modified content.
 */
export function addSubtaskInContent(content: string, lineNum: number, subtaskTitle: string): string {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) return content;

    const line = lines[idx];
    if (line === undefined) return content;
    const m = TASK_LINE_RE.exec(line);
    if (!m) return content;

    const [, indent] = m;
    const subIndent = (indent ?? '') + '    ';
    const subtaskLine = `${subIndent}- [ ] ${subtaskTitle}`;

    lines.splice(lineNum, 0, subtaskLine);
    return lines.join('\n');
}

// --- Re-parenting (make a task a subtask of another / top level) ---------
//
// The plugin-side twin of tasks.SetParent in notesmd-cli (pkg/tasks/subtasks.go):
// used in local mode, where there is no server to do it.

const BLOCK_TASK_RE = /^(\s*)-\s*\[([xX ])\]\s+(.*)$/;

function indentOf(line: string | undefined): number | null {
    if (line === undefined) return null;
    const m = BLOCK_TASK_RE.exec(line);
    return m ? (m[1] ?? '').length : null;
}

/** Index one past the task at `idx` and its descendants (contiguous deeper task lines). */
export function blockEnd(lines: string[], idx: number): number {
    const indent = indentOf(lines[idx]) ?? 0;
    let end = idx + 1;
    while (end < lines.length) {
        const i = indentOf(lines[end]);
        if (i === null || i <= indent) break;
        end++;
    }
    return end;
}

function reindent(line: string, delta: number): string {
    if (delta >= 0) return ' '.repeat(delta) + line;
    return line.replace(new RegExp(`^[ \\t]{0,${-delta}}`), '');
}

/** Removes the task at `lineNum` (1-based) with its subtasks. Null if that line isn't a task. */
export function extractBlock(content: string, lineNum: number): { block: string[]; rest: string; indent: number } | null {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    const indent = indentOf(lines[idx]);
    if (indent === null) return null;
    const end = blockEnd(lines, idx);
    return { block: lines.slice(idx, end), rest: [...lines.slice(0, idx), ...lines.slice(end)].join('\n'), indent };
}

/**
 * Inserts `block` (whose top line is indented `blockIndent`) as the last
 * subtask of the task at `parentLine` (1-based) in `content`. Returns the new
 * content and the block's new 1-based line, or null if `parentLine` isn't a task.
 */
export function insertBlockUnder(content: string, parentLine: number, block: string[], blockIndent: number): { content: string; newLine: number } | null {
    const lines = content.split('\n');
    const pIdx = parentLine - 1;
    const pIndent = indentOf(lines[pIdx]);
    if (pIndent === null) return null;
    const insertAt = blockEnd(lines, pIdx);
    const delta = pIndent + 4 - blockIndent;
    const moved = block.map((l) => reindent(l, delta));
    return { content: [...lines.slice(0, insertAt), ...moved, ...lines.slice(insertAt)].join('\n'), newLine: insertAt + 1 };
}

/** Same-file re-parent: the task (and its subtasks) becomes the last subtask of `parentLine`. Null when impossible (a cycle, or a non-task line). */
export function setParentInContent(content: string, lineNum: number, parentLine: number): { content: string; newLine: number } | null {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    if (indentOf(lines[idx]) === null) return null;
    const end = blockEnd(lines, idx);
    if (parentLine - 1 >= idx && parentLine - 1 < end) return null; // itself or one of its own subtasks
    const taken = extractBlock(content, lineNum);
    if (!taken) return null;
    const adjusted = parentLine - 1 >= end ? parentLine - (end - idx) : parentLine;
    return insertBlockUnder(taken.rest, adjusted, taken.block, taken.indent);
}

/** Promotes the task to top level, placed after its top-level ancestor's subtree. Null if the line isn't a task. */
export function promoteInContent(content: string, lineNum: number): { content: string; newLine: number } | null {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    const indent = indentOf(lines[idx]);
    if (indent === null) return null;
    if (indent === 0) return { content, newLine: lineNum };

    let root = idx;
    let rootIndent = indent;
    for (let i = idx - 1; i >= 0 && rootIndent > 0; i--) {
        const ii = indentOf(lines[i]);
        if (ii === null) break;
        if (ii < rootIndent) { root = i; rootIndent = ii; }
    }
    if (rootIndent !== 0) return null;

    const taken = extractBlock(content, lineNum);
    if (!taken) return null;
    const rest = taken.rest.split('\n');
    const insertAt = blockEnd(rest, root);
    const moved = taken.block.map((l) => reindent(l, -indent));
    return { content: [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)].join('\n'), newLine: insertAt + 1 };
}
