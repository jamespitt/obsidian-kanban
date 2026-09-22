// Pure HTTP layer for talking to notesmd-cli serve's task API, with no
// dependency on the Obsidian API - deliberately kept separate from view.ts
// (which does the actual vault/network I/O) so it stays easily unit-testable,
// the same way taskModel.ts is. All I/O is injected via ApiRequestFn; the
// production wiring to Obsidian's requestUrl lives in obsidianRequest.ts.
// Mirrors task-front-end's src/lib/api.ts conventions (URL shape, error
// handling, vault-param logic) but takes an explicit ApiConfig on every call
// instead of module-level mutable state, since this plugin has no natural
// page-scoped singleton - multiple open boards must each use their own
// settings snapshot.

import { KanbanStatus, KANBAN_STATUSES, Task, sameColumns } from './taskModel';

// The server's own fixed default (notesmd-cli/pkg/tasks/tasks.go:282) - NOT
// the same as this plugin's local KANBAN_STATUSES, which adds a 4th
// plugin-only "Delete" quick-action column with no server meaning. Comparing
// against KANBAN_STATUSES here would silently omit ?columns=/kanban_columns
// on the plugin's default board and break moves onto "Delete" (the server
// would reject it with a 400, since "Delete" isn't one of its three fixed
// tags without an explicit kanban_columns declaring it).
export const SERVER_DEFAULT_COLUMNS = ['ToDo', 'InProgress', 'Done'];

export interface ApiConfig {
    /** No trailing slash. */
    serverUrl: string;
    username: string;
    password: string;
    /** '' = the server's default vault. */
    vaultId: string;
}

export interface ApiRequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export interface ApiResponse {
    status: number;
    text: string;
    json: unknown;
}

export type ApiRequestFn = (url: string, init: ApiRequestInit) => Promise<ApiResponse>;

/** The Task JSON shape documented in notesmd-cli/API.md. */
export interface ApiTask {
    file_path: string;
    line_num: number;
    title: string;
    status: 'todo' | 'completed';
    due?: string;
    scheduled?: string;
    priority?: string;
    repeat?: string;
    tags: string[];
    list_name: string;
    google_id?: string;
}

export interface VaultInfo {
    id: string;
    label: string;
    default?: boolean;
}

interface NodeBufferLike {
    from(input: string, encoding: string): { toString(encoding: string): string };
}

function base64Encode(s: string): string {
    if (typeof btoa === 'function') return btoa(s);
    // Node test harness only; no `btoa` global there.
    const nodeBuffer = (globalThis as unknown as { Buffer?: NodeBufferLike }).Buffer;
    if (!nodeBuffer) throw new Error('No base64 encoder available (need btoa or Buffer)');
    return nodeBuffer.from(s, 'utf-8').toString('base64');
}

/** `{}` when `username` is empty, else an `Authorization: Basic ...` header, sent on every request. */
export function buildAuthHeader(username: string, password: string): Record<string, string> {
    if (!username) return {};
    return { Authorization: 'Basic ' + base64Encode(`${username}:${password}`) };
}

function apiBase(config: ApiConfig): string {
    return config.serverUrl.replace(/\/+$/, '') + '/api';
}

/** Appends `?vault=<id>` (or `&vault=` if the URL already has a `?`) when `config.vaultId` is set. */
function withVaultParam(url: string, config: ApiConfig): string {
    if (!config.vaultId) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}vault=${encodeURIComponent(config.vaultId)}`;
}

function headers(config: ApiConfig, extra?: Record<string, string>): Record<string, string> {
    return { ...buildAuthHeader(config.username, config.password), ...extra };
}

async function errorFor(verb: string, res: ApiResponse): Promise<Error> {
    const body = res.json as { error?: string } | null;
    const message = (body && typeof body === 'object' && typeof body.error === 'string') ? body.error : res.text || `HTTP ${res.status}`;
    return new Error(`Failed to ${verb}: ${res.status} ${message}`);
}

/** GET /api/tasks/kanban, with `?columns=` only when `columns` differs from the server's own fixed default. */
export async function fetchKanbanTasks(request: ApiRequestFn, config: ApiConfig, columns: readonly string[] = KANBAN_STATUSES): Promise<ApiTask[]> {
    let url = withVaultParam(`${apiBase(config)}/tasks/kanban`, config);
    if (!sameColumns(columns, SERVER_DEFAULT_COLUMNS)) {
        const sep = url.includes('?') ? '&' : '?';
        url += `${sep}columns=${encodeURIComponent(columns.join(','))}`;
    }
    const res = await request(url, { method: 'GET', headers: headers(config) });
    if (res.status < 200 || res.status >= 300) throw await errorFor('load kanban tasks', res);
    const body = res.json as { tasks?: ApiTask[] } | null;
    return body?.tasks ?? [];
}

/** PATCH /api/tasks/{filePath}, action "set-status-tag". */
export async function setKanbanStatus(
    request: ApiRequestFn,
    config: ApiConfig,
    filePath: string,
    lineNum: number,
    status: KanbanStatus,
    columns: readonly string[] = KANBAN_STATUSES
): Promise<void> {
    const url = withVaultParam(`${apiBase(config)}/tasks/${filePath}`, config);
    const body: Record<string, unknown> = { action: 'set-status-tag', line: lineNum, kanban_status: status };
    if (!sameColumns(columns, SERVER_DEFAULT_COLUMNS)) body.kanban_columns = columns;
    const res = await request(url, { method: 'PATCH', headers: headers(config, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (res.status < 200 || res.status >= 300) throw await errorFor('move task', res);
}

/** PATCH /api/tasks/{filePath}, action "rename". */
export async function renameTask(request: ApiRequestFn, config: ApiConfig, filePath: string, lineNum: number, newTitle: string): Promise<void> {
    const url = withVaultParam(`${apiBase(config)}/tasks/${filePath}`, config);
    const body = { action: 'rename', line: lineNum, title: newTitle };
    const res = await request(url, { method: 'PATCH', headers: headers(config, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (res.status < 200 || res.status >= 300) throw await errorFor('rename task', res);
}

/** GET /api/vaults. Deliberately never vault-scoped: a stale vault id must not 404 the very call meant to recover from it. 404 means a pre-vault-switching server, treated as "no vaults configured". */
export async function fetchVaults(request: ApiRequestFn, config: ApiConfig): Promise<VaultInfo[]> {
    const res = await request(`${apiBase(config)}/vaults`, { method: 'GET', headers: headers(config) });
    if (res.status === 404) return [];
    if (res.status < 200 || res.status >= 300) throw await errorFor('load vaults', res);
    const body = res.json as { vaults?: VaultInfo[] } | null;
    return body?.vaults ?? [];
}

/** GET /api/notes/{path}. 404 -> null (rather than throwing) so callers can fall back cleanly. */
export async function fetchNote(request: ApiRequestFn, config: ApiConfig, path: string): Promise<{ path: string; content: string } | null> {
    const url = withVaultParam(`${apiBase(config)}/notes/${path}`, config);
    const res = await request(url, { method: 'GET', headers: headers(config) });
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) throw await errorFor('load note', res);
    const body = res.json as { path?: string; content?: string } | null;
    if (!body || typeof body.path !== 'string' || typeof body.content !== 'string') return null;
    return { path: body.path, content: body.content };
}

/** Maps a server Task JSON object onto this plugin's local Task shape. `source`/`user`/`created`/`subtasks` have no server equivalent and are left undefined - a display-fidelity gap only, not an identity one (file_path+line_num map 1:1 either way). */
export function apiTaskToTask(apiTask: ApiTask): Task {
    return {
        filePath: apiTask.file_path,
        lineNum: apiTask.line_num,
        title: apiTask.title,
        status: apiTask.status,
        due: apiTask.due,
        scheduled: apiTask.scheduled,
        priority: apiTask.priority,
        repeat: apiTask.repeat,
        tags: apiTask.tags ?? [],
        listName: apiTask.list_name
    };
}
