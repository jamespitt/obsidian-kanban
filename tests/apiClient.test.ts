import {
    ApiConfig,
    ApiRequestFn,
    ApiRequestInit,
    ApiResponse,
    SERVER_DEFAULT_COLUMNS,
    addSubtask,
    addTask,
    apiTaskToTask,
    buildAuthHeader,
    fetchKanbanTasks,
    fetchLists,
    fetchNote,
    fetchVaults,
    renameTask,
    setDueDate,
    setKanbanStatus,
    setTaskField
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

    // --- fetchLists / addTask / addSubtask / setDueDate ---

    {
        const { request, calls } = fakeRequest([jsonResponse(200, { lists: ['Obsidian', 'Action Items'] })]);
        const lists = await fetchLists(request, configWithVault);
        assertEqual(lists, ['Obsidian', 'Action Items'], 'fetchLists returns the lists array');
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/lists?vault=work', 'fetchLists is vault-scoped');
    }
    {
        const { request } = fakeRequest([jsonResponse(200, {})]);
        assertEqual(await fetchLists(request, config), [], 'fetchLists defaults to [] when the key is missing');
    }
    {
        const { request } = fakeRequest([jsonResponse(500, { error: 'boom' })]);
        await assertThrows(() => fetchLists(request, config), 'boom', 'fetchLists surfaces a server error');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(201, { list: 'Action Items', title: 'x' })]);
        await addTask(request, configWithVault, 'Action Items', 'Buy milk #ToDo');
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/list/Action%20Items?vault=work',
            'addTask URL-encodes the list name and is vault-scoped');
        assertEqual(calls[0]?.init.method, 'POST', 'addTask uses POST');
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { title: 'Buy milk #ToDo' }, 'addTask sends only the title by default');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(201, {})]);
        await addTask(request, config, 'Work', 'Ship it #Done', true);
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { title: 'Ship it #Done', status: 'completed' },
            'addTask sends status "completed" for a task created in the Done column');
    }
    {
        const { request } = fakeRequest([jsonResponse(404, { error: 'list "Nope" not found' })]);
        await assertThrows(() => addTask(request, config, 'Nope', 'x'), 'not found', 'addTask surfaces a 404');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await addSubtask(request, config, 'Tasks/Work.md', 7, 'Do the thing');
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/Tasks/Work.md', 'addSubtask targets the parent file');
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'add-subtask', line: 7, title: 'Do the thing' },
            'addSubtask sends the parent line and title');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await setDueDate(request, config, 'Work.md', 3, '2026-09-30');
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'set-due', line: 3, due: '2026-09-30' }, 'setDueDate uses set-due');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await setDueDate(request, config, 'Work.md', 3, null);
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'edit', line: 3, due: '' },
            'setDueDate clears via edit with an empty due (set-due rejects an empty date)');
    }

    // --- setTaskField ---

    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await setTaskField(request, configWithVault, 'Tasks/Work.md', 3, 'scheduled', '2026-09-05T10:00');
        assertEqual(calls[0]?.url, 'https://tasks.example.com/api/tasks/Tasks/Work.md?vault=work', 'setTaskField is vault-scoped and targets the file');
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'edit', line: 3, scheduled: '2026-09-05T10:00' }, 'setTaskField edits only the one field');
    }
    {
        const { request, calls } = fakeRequest([jsonResponse(200, {})]);
        await setTaskField(request, config, 'Work.md', 3, 'priority', null);
        assertEqual(JSON.parse(calls[0]?.init.body ?? '{}'), { action: 'edit', line: 3, priority: '' }, 'setTaskField clears a field with an empty string, not by omitting it');
    }
    {
        const { request } = fakeRequest([jsonResponse(400, { error: 'bad repeat' })]);
        await assertThrows(() => setTaskField(request, config, 'Work.md', 3, 'repeat', 'x'), 'bad repeat', 'setTaskField surfaces a server error');
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

    {
        const t = apiTaskToTask({ file_path: 'W.md', line_num: 1, title: 'x', status: 'todo', tags: [], list_name: 'W',
            created: '2026-09-22', source: 'wiki/a.md', user: 'A, B' });
        assertEqual([t.created, t.source, t.user], ['2026-09-22', 'wiki/a.md', 'A, B'], 'apiTaskToTask carries created/source/user from the server');
    }

    console.debug('\nAll apiClient checks passed.');
}

run().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    throw e; // unhandled rejection -> non-zero exit code
});
