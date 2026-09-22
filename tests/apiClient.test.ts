import {
    ApiConfig,
    ApiRequestFn,
    ApiRequestInit,
    ApiResponse,
    SERVER_DEFAULT_COLUMNS,
    apiTaskToTask,
    buildAuthHeader,
    fetchKanbanTasks,
    fetchNote,
    fetchVaults,
    renameTask,
    setKanbanStatus
} from '../src/apiClient';

function assertEqual(actual: unknown, expected: unknown, label: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
    console.debug(`ok - ${label}`);
}

async function assertThrows(fn: () => Promise<unknown>, expectedSubstring: string, label: string) {
    try {
        await fn();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes(expectedSubstring)) {
            throw new Error(`FAIL: ${label}\n  expected message to include: ${expectedSubstring}\n  actual: ${message}`);
        }
        console.debug(`ok - ${label}`);
        return;
    }
    throw new Error(`FAIL: ${label}\n  expected a throw, got none`);
}

interface Call { url: string; init: ApiRequestInit }

function fakeRequest(responses: ApiResponse[]): { request: ApiRequestFn; calls: Call[] } {
    const calls: Call[] = [];
    let i = 0;
    const request: ApiRequestFn = async (url, init) => {
        calls.push({ url, init });
        const res = responses[Math.min(i, responses.length - 1)];
        i++;
        if (!res) throw new Error('fakeRequest: no response configured');
        return res;
    };
    return { request, calls };
}

function jsonResponse(status: number, body: unknown): ApiResponse {
    return { status, text: JSON.stringify(body), json: body };
}

const config: ApiConfig = { serverUrl: 'https://tasks.example.com', username: '', password: '', vaultId: '' };
const configWithVault: ApiConfig = { serverUrl: 'https://tasks.example.com', username: '', password: '', vaultId: 'work' };

async function run() {
    // --- buildAuthHeader ---

    assertEqual(buildAuthHeader('', ''), {}, 'buildAuthHeader is empty with no username');
    assertEqual(buildAuthHeader('user', 'pass'), { Authorization: 'Basic dXNlcjpwYXNz' },
        'buildAuthHeader encodes user:pass as base64');

    // --- fetchKanbanTasks ---

    {
        const { request, calls } = fakeRequest([jsonResponse(200, { tasks: [] })]);
        await fetchKanbanTasks(request, config, SERVER_DEFAULT_COLUMNS);
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/kanban',
            'fetchKanbanTasks omits ?columns= for the server default');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, { tasks: [] })]);
        await fetchKanbanTasks(request, config, ['ToDo', 'InProgress', 'Done', 'Delete']);
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/kanban?columns=ToDo%2CInProgress%2CDone%2CDelete',
            "fetchKanbanTasks sends ?columns= for the plugin's actual 4-column default (includes Delete)");
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, { tasks: [] })]);
        await fetchKanbanTasks(request, configWithVault, ['Backlog', 'Done']);
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/kanban?vault=work&columns=Backlog%2CDone',
            'fetchKanbanTasks appends &columns= after an existing ?vault=');
    }
    {
        const apiTask = { file_path: 'Work.md', line_num: 3, title: 'Ship it', status: 'todo' as const, tags: ['ToDo'], list_name: 'Work' };
        const { request } = fakeRequest([jsonResponse(200, { tasks: [apiTask] })]);
        const tasks = await fetchKanbanTasks(request, config, SERVER_DEFAULT_COLUMNS);
        assertEqual(tasks, [apiTask], 'fetchKanbanTasks returns the tasks array from the response');
    }
    {
        const { request } = fakeRequest([jsonResponse(200, {})]);
        const tasks = await fetchKanbanTasks(request, config, SERVER_DEFAULT_COLUMNS);
        assertEqual(tasks, [], 'fetchKanbanTasks defaults to [] when the tasks key is missing');
    }
    {
        const { request } = fakeRequest([jsonResponse(500, { error: 'boom' })]);
        await assertThrows(() => fetchKanbanTasks(request, config, SERVER_DEFAULT_COLUMNS), '500',
            'fetchKanbanTasks throws including the status on a non-2xx response');
    }
    {
        const { request } = fakeRequest([jsonResponse(500, { error: 'boom' })]);
        await assertThrows(() => fetchKanbanTasks(request, config, SERVER_DEFAULT_COLUMNS), 'boom',
            'fetchKanbanTasks includes the server error message');
    }

    // --- setKanbanStatus ---

    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await setKanbanStatus(request, config, 'Work.md', 3, 'InProgress', SERVER_DEFAULT_COLUMNS);
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/Work.md', "setKanbanStatus targets the task's file path");
        assertEqual(calls[0]?.init.method, 'PATCH', 'setKanbanStatus uses PATCH');
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'set-status-tag', line: 3, kanban_status: 'InProgress' },
            'setKanbanStatus omits kanban_columns for the server default');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await setKanbanStatus(request, config, 'Work.md', 3, 'Delete', ['ToDo', 'InProgress', 'Done', 'Delete']);
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'),
            { action: 'set-status-tag', line: 3, kanban_status: 'Delete', kanban_columns: ['ToDo', 'InProgress', 'Done', 'Delete'] },
            "setKanbanStatus includes kanban_columns for the plugin's non-server-default columns (e.g. moving onto Delete)");
    }
    {
        const { request } = fakeRequest([jsonResponse(400, { error: 'invalid column' })]);
        await assertThrows(() => setKanbanStatus(request, config, 'Work.md', 3, 'Delete', SERVER_DEFAULT_COLUMNS), 'invalid column',
            'setKanbanStatus surfaces a 400 from the server');
    }

    // --- renameTask ---

    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await renameTask(request, config, 'Work.md', 3, 'New title   [[Note]]');
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'rename', line: 3, title: 'New title   [[Note]]' },
            'renameTask sends the rename action with the full new title');
    }

    // --- fetchVaults ---

    {
        const { request, calls } = fakeRequest([jsonResponse(404, { error: 'not found' })]);
        const vaults = await fetchVaults(request, configWithVault);
        assertEqual(vaults, [], 'fetchVaults treats 404 as a pre-vault-switching server');
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/vaults',
            'fetchVaults never appends a vault param, even when one is configured');
    }
    {
        const vaultsBody = { vaults: [{ id: 'personal', label: 'Personal', default: true }, { id: 'work', label: 'Work' }] };
        const { request } = fakeRequest([jsonResponse(200, vaultsBody)]);
        const vaults = await fetchVaults(request, config);
        assertEqual(vaults, vaultsBody.vaults, 'fetchVaults returns the parsed vault list');
    }

    // --- fetchNote ---

    {
        const { request } = fakeRequest([jsonResponse(404, { error: 'not found' })]);
        const note = await fetchNote(request, config, 'Projects/Foo.md');
        assertEqual(note, null, 'fetchNote returns null on 404 rather than throwing');
    }
    {
        const body = { path: 'Projects/Foo.md', content: '# Foo\n' };
        const { request, calls } = fakeRequest([jsonResponse(200, body)]);
        const note = await fetchNote(request, configWithVault, 'Projects/Foo.md');
        assertEqual(note, { path: 'Projects/Foo.md', content: '# Foo\n' }, 'fetchNote returns the path/content on success');
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/notes/Projects/Foo.md?vault=work', 'fetchNote is vault-scoped');
    }

    // --- apiTaskToTask ---

    {
        const apiTask = {
            file_path: 'Tasks/Work.md', line_num: 4, title: 'Buy milk', status: 'completed' as const,
            due: '2026-08-20', scheduled: '2026-08-19T09:00', priority: 'high', repeat: 'every day',
            tags: ['groceries', 'Done'], list_name: 'Work', google_id: 'abc123'
        };
        assertEqual(apiTaskToTask(apiTask), {
            filePath: 'Tasks/Work.md', lineNum: 4, title: 'Buy milk', status: 'completed',
            due: '2026-08-20', scheduled: '2026-08-19T09:00', priority: 'high', repeat: 'every day',
            tags: ['groceries', 'Done'], listName: 'Work'
        }, 'apiTaskToTask maps every server field onto the plugin Task shape');
    }
    {
        const apiTask = { file_path: 'Work.md', line_num: 1, title: 'Plain task', status: 'todo' as const, tags: [], list_name: 'Work' };
        const task = apiTaskToTask(apiTask);
        assertEqual(task.due, undefined, 'apiTaskToTask leaves a missing due field undefined, not empty string');
        assertEqual(task.priority, undefined, 'apiTaskToTask leaves a missing priority field undefined');
    }

    console.debug('\nAll apiClient checks passed.');
}

run().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    throw e; // unhandled rejection -> non-zero exit code
});
