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

// The three mutually-exclusive tags that place a task on the Kanban board -
// matches KanbanTags/KANBAN_STATUSES in pkg/tasks and api.ts exactly.
export const KANBAN_STATUSES = ['ToDo', 'InProgress', 'Done'] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

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

/** A task's current Kanban column, or null if it carries none of the KANBAN_STATUSES tags. */
export function kanbanStatus(task: Task): KanbanStatus | null {
    const tagsLower = new Set(task.tags.map((t) => t.toLowerCase()));
    for (const status of KANBAN_STATUSES) {
        if (tagsLower.has(status.toLowerCase())) return status;
    }
    return null;
}

/** Tasks carrying one of the KANBAN_STATUSES tags, regardless of completion status. */
export function filterKanban(tasks: Task[]): Task[] {
    return tasks.filter((t) => kanbanStatus(t) !== null);
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

/**
 * A board file's content is just its tag filter, not task data - tasks
 * always live in the real vault files. Parses that filter back out of the
 * saved content: the first "filter: a, b, c" line found, comma-separated,
 * '#' optional per-tag. No such line (a fresh or blank file) means no
 * filter - show every #ToDo/#InProgress/#Done task in scope.
 */
export function parseBoardFilter(content: string): string[] {
    for (const line of content.split('\n')) {
        const m = FILTER_LINE_RE.exec(line);
        if (m) {
            return (m[1] ?? '')
                .split(',')
                .map((t) => t.trim().replace(/^#/, ''))
                .filter((t) => t.length > 0);
        }
    }
    return [];
}

/** Inverse of parseBoardFilter - the content written back to a board file. */
export function serializeBoardFilter(filterTags: string[]): string {
    const desc = filterTags.length > 0
        ? `Showing #ToDo/#InProgress/#Done tasks tagged ${filterTags.map((t) => `#${t}`).join(', ')}.`
        : 'Showing every #ToDo/#InProgress/#Done task in scope.';
    return `%% Kanban board - ${desc} Edit the filter below (comma-separated tags, blank = show all) and re-open the board to apply it. %%\nfilter: ${filterTags.join(', ')}\n`;
}

/**
 * Given the raw text of a file and the 1-based line number of a task within
 * it, returns the file with that task's Kanban status tag replaced by
 * `status` (pass null to remove it without adding a new one), and its
 * checkbox synced to match - `Done` checks the task off, anything else
 * un-checks it. Every other tag and [key::value] field is left untouched.
 * Returns the original content unchanged if lineNum doesn't point at a task
 * line (out of range, or not a checkbox).
 */
export function setStatusTagInContent(content: string, lineNum: number, status: KanbanStatus | null): string {
    const lines = content.split('\n');
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) return content;

    const line = lines[idx];
    if (line === undefined) return content;
    const m = TASK_LINE_RE.exec(line);
    if (!m) return content;

    const [, indent, , rawBody] = m;
    let raw = rawBody ?? '';
    for (const kt of KANBAN_STATUSES) {
        raw = raw.replace(new RegExp(`#${kt}\\b`, 'gi'), '');
    }
    raw = raw.trim();
    if (status) raw = `${raw} #${status}`.trim();

    const checkbox = status === 'Done' ? 'x' : ' ';
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
