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
}

// The three mutually-exclusive tags used when a board doesn't specify its
// own custom columns (see parseBoardColumns below) - matches KanbanTags/
// KANBAN_STATUSES in pkg/tasks and api.ts exactly, which is what keeps a
// default board's columns showing the same set of tasks as task-front-end's
// Kanban tab and task_viewer.py's Kanban view. A board with custom columns
// necessarily diverges from those two, since they only know this fixed set.
export const KANBAN_STATUSES = ['ToDo', 'InProgress', 'Done'] as const;
// Any tag name can be a column once boards can define their own, so this is
// just a readability alias now, not a closed union.
export type KanbanStatus = string;

const TASK_LINE_RE = /^(\s*)-\s*\[([xX ])\]\s+(.*)$/;
const DATAVIEW_RE = /\[([^\]]+?)::([^\]]*)\]/g;
const TAG_RE = /#([\w/]+)/g;

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

    const tags: string[] = [];
    for (const tm of (rawBody ?? '').matchAll(TAG_RE)) {
        if (tm[1]) tags.push(tm[1]);
    }

    const title = (rawBody ?? '')
        .replace(DATAVIEW_RE, '')
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
        listName
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
