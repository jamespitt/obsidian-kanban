import {
    parseTaskLine,
    kanbanStatus,
    filterKanban,
    setStatusTagInContent,
    applyKanbanStatus,
    sameColumns,
    KANBAN_STATUSES,
    matchesFilter,
    parseBoardFilter,
    parseBoardColumns,
    serializeBoardConfig,
    columnLabel,
    noteTitleFromTask,
    addNoteLinkToContent,
    extractWikilink,
    replaceWikilink,
    setProjectLinkInContent,
    taskProject,
    matchesProjectFilter,
    isProjectNote,
    boardProjectOptions,
    parseBoardProject,
    BOARD_NO_PROJECT,
    setDueDateInContent,
    setFieldInContent,
    foldSubtasks,
    subtaskProgress,
    setParentInContent,
    promoteInContent,
    extractBlock,
    insertBlockUnder,
    splitScheduled,
    joinScheduled,
    addSubtaskInContent,
    stampCreated,
    clock,
    nowStamp,
    idSource,
    newTaskId
} from '../src/taskModel';

// Freeze the plugin's clock so [updated::] stamps can be asserted exactly.
const FROZEN = new Date();
clock.now = () => FROZEN;

// Pin the id generator too, so created lines can be asserted whole.
const TEST_ID = 'testtask00';
const randomId = idSource.next;
idSource.next = () => TEST_ID;

/** The [updated::] value the code under test writes. */
function stamp(): string {
    return FROZEN.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Mirrors todayStr() in taskModel.ts, for asserting on [created::]/[updated::]
// stamps without depending on the exact date the tests happen to run on.
function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
    console.debug(`ok - ${label}`);
}

function assert(condition: boolean, label: string) {
    assertEqual(condition, true, label);
}

function run() {
    // --- parseTaskLine ---

    const t1 = parseTaskLine('- [ ] Buy milk #groceries #ToDo [due::2026-08-20]', 'Tasks/Work.md', 3);
    if (!t1) throw new Error('FAIL: expected a task, got null');
    assertEqual(t1.title, 'Buy milk', 'parses title with tags/fields stripped');
    assertEqual(t1.status, 'todo', 'parses unchecked status');
    assertEqual(t1.due, '2026-08-20', 'parses due field');
    assertEqual(t1.tags, ['groceries', 'ToDo'], 'parses all tags, not just the first');
    assertEqual(t1.listName, 'Work', 'derives list name from file stem');
    assertEqual(t1.lineNum, 3, 'preserves line number');

    const tWithDateTime = parseTaskLine('- [ ] Buy milk #groceries #ToDo [due::2026-08-20 14:30]', 'Tasks/Work.md', 3);
    if (!tWithDateTime) throw new Error('FAIL: expected a task, got null');
    assertEqual(tWithDateTime.due, '2026-08-20 14:30', 'parses due date and time field');

    const t2 = parseTaskLine('    - [x] Done thing #Done', 'Work.md', 5);
    if (!t2) throw new Error('FAIL: expected a task, got null');
    assertEqual(t2.status, 'completed', 'parses checked status');

    const tWithSourceAndUser = parseTaskLine('- [ ] Review plan #ToDo [source:: /meetings/Standup] [user:: James Pitt]', 'Tasks/Work.md', 4);
    if (!tWithSourceAndUser) throw new Error('FAIL: expected a task, got null');
    assertEqual(tWithSourceAndUser.source, '/meetings/Standup', 'parses source field');
    assertEqual(tWithSourceAndUser.user, 'James Pitt', 'parses user field');

    const tWithCreated = parseTaskLine('- [ ] Follow up on tests [created: 2026-09-18] #ToTriage', 'Work.md', 1);
    if (!tWithCreated) throw new Error('FAIL: expected a task, got null');
    assertEqual(tWithCreated.title, 'Follow up on tests', 'strips created date from title');
    assertEqual(tWithCreated.created, '2026-09-18', 'parses created date');

    const tWithUpdated = parseTaskLine('- [ ] Follow up on tests [created::2026-09-18] [updated: 2026-09-25] #ToTriage', 'Work.md', 1);
    if (!tWithUpdated) throw new Error('FAIL: expected a task, got null');
    assertEqual(tWithUpdated.title, 'Follow up on tests', 'strips updated date from title too');
    assertEqual(tWithUpdated.updated, '2026-09-25', 'parses updated date');

    const notATask = parseTaskLine('Just a line of text', 'Work.md', 1);
    assertEqual(notATask, null, 'non-task lines return null');

    // --- kanbanStatus / filterKanban ---

    assertEqual(kanbanStatus(t1), 'ToDo', 'kanbanStatus finds the matching tag');
    const untagged = parseTaskLine('- [ ] No status tag', 'Work.md', 1)!;
    assertEqual(kanbanStatus(untagged), null, 'kanbanStatus is null with no matching tag');

    const caseInsensitive = parseTaskLine('- [ ] Task #inprogress', 'Work.md', 1)!;
    assertEqual(kanbanStatus(caseInsensitive), 'InProgress', 'kanbanStatus is case-insensitive');

    const board = filterKanban([t1, t2, untagged]);
    assertEqual(board.map((t) => t.title), ['Buy milk', 'Done thing'], 'filterKanban keeps only tagged tasks, completed included');

    // A board with its own custom columns only recognizes those tags, not the default three.
    const customTask = parseTaskLine('- [ ] Review PR #Backlog', 'Work.md', 1)!;
    assertEqual(kanbanStatus(customTask, ['Backlog', 'InReview', 'Shipped']), 'Backlog',
        'kanbanStatus respects a custom column list');
    assertEqual(kanbanStatus(t1, ['Backlog', 'InReview', 'Shipped']), null,
        'a task tagged for the default columns is off a board using custom ones');
    assertEqual(filterKanban([t1, customTask], ['Backlog']).map((t) => t.title), ['Review PR'],
        'filterKanban respects a custom column list too');

    // --- setStatusTagInContent ---

    const file = '# Work\n\n- [ ] Buy milk #groceries #ToDo [due::2026-08-20]\n- [ ] Other task\n';

    // Matches pkg/tasks.go's SetStatusTag exactly: the removed tag leaves an
    // internal double space (only trimmed at the ends), and the new status
    // tag is appended at the end rather than reinserted in its old spot.
    // Every write also touches [updated::NOW] (touchUpdated), same as the
    // server's SetStatusTagIn.
    const moved = setStatusTagInContent(file, 3, 'InProgress');
    const movedLines = moved.split('\n');
    assertEqual(movedLines[2], `- [ ] Buy milk #groceries  [due::2026-08-20] #InProgress [updated::${stamp()}]`,
        'setStatusTagInContent swaps the tag, keeps other tags/fields, keeps checkbox unchecked');

    const completed = setStatusTagInContent(file, 3, 'Done');
    const completedLines = completed.split('\n');
    assertEqual(completedLines[2], `- [x] Buy milk #groceries  [due::2026-08-20] #Done [updated::${stamp()}]`,
        'setStatusTagInContent checks the box when moving to Done');

    const removed = setStatusTagInContent(file, 3, null);
    const removedLines = removed.split('\n');
    assertEqual(removedLines[2], `- [ ] Buy milk #groceries  [due::2026-08-20] [updated::${stamp()}]`,
        'setStatusTagInContent removes the status tag entirely when given null');

    const untouched = setStatusTagInContent(file, 4, 'ToDo');
    assertEqual(untouched.split('\n')[3], `- [ ] Other task #ToDo [updated::${stamp()}]`, 'targets only the given line');

    const outOfRange = setStatusTagInContent(file, 99, 'ToDo');
    assertEqual(outOfRange, file, 'is a no-op for an out-of-range line number');

    const uncheckedFromDone = setStatusTagInContent('- [x] Done item #Done\n', 1, 'ToDo');
    assertEqual(uncheckedFromDone.trimEnd(), `- [ ] Done item #ToDo [updated::${stamp()}]`, 'un-checks the box when moving off Done');

    // Custom columns: only the board's own tags get stripped, and only a
    // column literally named "Done" (case-insensitive) completes the task.
    const customFile = '- [ ] Ship it #Backlog\n';
    const toShipped = setStatusTagInContent(customFile, 1, 'Shipped', ['Backlog', 'InReview', 'Shipped']);
    assertEqual(toShipped.trimEnd(), `- [ ] Ship it #Shipped [updated::${stamp()}]`, 'moves within a custom column set, no #Done involved');

    const toDoneCustom = setStatusTagInContent(customFile, 1, 'done', ['Backlog', 'InReview', 'done']);
    assertEqual(toDoneCustom.trimEnd(), `- [x] Ship it #done [updated::${stamp()}]`, 'a custom column literally named "done" (any case) still completes the task');

    const leavesOtherTags = setStatusTagInContent('- [ ] Ship it #Backlog #urgent\n', 1, 'InReview', ['Backlog', 'InReview']);
    assertEqual(leavesOtherTags.trimEnd(), `- [ ] Ship it  #urgent #InReview [updated::${stamp()}]`,
        "only the board's own column tags are stripped - a non-column tag like #urgent is left alone");

    // --- sameColumns ---

    assertEqual(sameColumns(['ToDo', 'InProgress'], ['ToDo', 'InProgress']), true, 'sameColumns matches identical lists');
    assertEqual(sameColumns(['todo', 'INPROGRESS'], ['ToDo', 'InProgress']), true, 'sameColumns is case-insensitive');
    assertEqual(sameColumns(['ToDo'], ['ToDo', 'InProgress']), false, 'sameColumns is false for different lengths');
    assertEqual(sameColumns(['InProgress', 'ToDo'], ['ToDo', 'InProgress']), false, 'sameColumns is order-sensitive');

    // --- applyKanbanStatus ---

    const optimisticTask = parseTaskLine('- [ ] Buy milk #groceries #ToDo [due::2026-08-20]', 'Tasks/Work.md', 3)!;

    const movedInMemory = applyKanbanStatus(optimisticTask, 'InProgress');
    assertEqual(movedInMemory.tags, ['groceries', 'InProgress'], 'applyKanbanStatus swaps the column tag, keeps other tags');
    assertEqual(movedInMemory.status, 'todo', 'applyKanbanStatus leaves status todo when not moving to Done');
    assertEqual(optimisticTask.tags, ['groceries', 'ToDo'], 'applyKanbanStatus does not mutate the original task');

    const completedInMemory = applyKanbanStatus(optimisticTask, 'Done');
    assertEqual(completedInMemory.tags, ['groceries', 'Done'], 'applyKanbanStatus swaps to the Done tag');
    assertEqual(completedInMemory.status, 'completed', 'applyKanbanStatus marks status completed when moving to Done');

    const clearedInMemory = applyKanbanStatus(optimisticTask, null);
    assertEqual(clearedInMemory.tags, ['groceries'], 'applyKanbanStatus removes the column tag entirely for null');
    assertEqual(clearedInMemory.status, 'todo', 'applyKanbanStatus leaves status todo when clearing the column');

    const customColumnTask = parseTaskLine('- [ ] Ship it #Backlog', 'Work.md', 1)!;
    const movedCustom = applyKanbanStatus(customColumnTask, 'Shipped', ['Backlog', 'InReview', 'Shipped']);
    assertEqual(movedCustom.tags, ['Shipped'], 'applyKanbanStatus respects a custom column list');

    const movedCustomDone = applyKanbanStatus(customColumnTask, 'done', ['Backlog', 'InReview', 'done']);
    assertEqual(movedCustomDone.status, 'completed', 'applyKanbanStatus completes on a custom column literally named "done"');

    // --- setDueDateInContent --- (every write touches [updated::NOW], same as setFieldInContent below)
    const dueTestFile = '- [ ] Buy bread #groceries [due::2026-09-01]\n- [ ] Plain task\n';
    const dueUpdated = setDueDateInContent(dueTestFile, 1, '2026-09-18');
    assertEqual(dueUpdated.split('\n')[0], `- [ ] Buy bread #groceries [due::2026-09-18] [updated::${stamp()}]`,
        'setDueDateInContent updates an existing due date');

    const dueUpdatedWithTime = setDueDateInContent(dueTestFile, 1, '2026-09-18 14:30');
    assertEqual(dueUpdatedWithTime.split('\n')[0], `- [ ] Buy bread #groceries [due::2026-09-18 14:30] [updated::${stamp()}]`,
        'setDueDateInContent updates an existing due date with date and time');

    const dueRemoved = setDueDateInContent(dueTestFile, 1, null);
    assertEqual(dueRemoved.split('\n')[0], `- [ ] Buy bread #groceries [updated::${stamp()}]`,
        'setDueDateInContent removes an existing due date');

    const dueAdded = setDueDateInContent(dueTestFile, 2, '2026-09-18');
    assertEqual(dueAdded.split('\n')[1], `- [ ] Plain task [due::2026-09-18] [updated::${stamp()}]`,
        'setDueDateInContent adds a due date if none existed');

    const dueAddedWithTime = setDueDateInContent(dueTestFile, 2, '2026-09-18 14:30');
    assertEqual(dueAddedWithTime.split('\n')[1], `- [ ] Plain task [due::2026-09-18 14:30] [updated::${stamp()}]`,
        'setDueDateInContent adds a due date and time if none existed');

    // --- setFieldInContent (scheduled / priority / repeat) ---
    const fieldFile = '- [ ] Standup #ToDo [due::2026-09-01] [scheduled::2026-09-02T09:30] [priority::high] [google_id::abc]\n- [x] Plain\n';
    assertEqual(setFieldInContent(fieldFile, 1, 'scheduled', '2026-09-05T10:00').split('\n')[0],
        `- [ ] Standup #ToDo [due::2026-09-01] [scheduled::2026-09-05T10:00] [priority::high] [google_id::abc] [updated::${stamp()}]`,
        'setFieldInContent replaces scheduled in place, leaving every other field alone');
    assertEqual(setFieldInContent(fieldFile, 1, 'priority', null).split('\n')[0],
        `- [ ] Standup #ToDo [due::2026-09-01] [scheduled::2026-09-02T09:30] [google_id::abc] [updated::${stamp()}]`,
        'setFieldInContent removes priority when cleared');
    assertEqual(setFieldInContent(fieldFile, 2, 'repeat', 'every week').split('\n')[1], `- [x] Plain [repeat::every week] [updated::${stamp()}]`,
        'setFieldInContent adds a missing repeat and keeps the checkbox state');
    assertEqual(setFieldInContent(fieldFile, 1, 'repeat', ''),
        `- [ ] Standup #ToDo [due::2026-09-01] [scheduled::2026-09-02T09:30] [priority::high] [google_id::abc] [updated::${stamp()}]\n- [x] Plain\n`,
        'setFieldInContent with an empty value on a missing field still stamps [updated::], even though no field changed');
    assertEqual(setFieldInContent('- [ ] Odd [Priority :: low]', 1, 'priority', 'high'), `- [ ] Odd [priority::high] [updated::${stamp()}]`,
        'setFieldInContent matches the key case-insensitively and with spaces around ::');
    assertEqual(setFieldInContent(fieldFile, 99, 'repeat', 'x'), fieldFile, 'setFieldInContent ignores an out-of-range line');
    assertEqual(setFieldInContent('not a task', 1, 'repeat', 'x'), 'not a task', 'setFieldInContent ignores a non-task line');

    assertEqual(splitScheduled('2026-03-27T09:30'), { date: '2026-03-27', time: '09:30' }, 'splitScheduled splits date and time (T)');
    assertEqual(splitScheduled('2026-03-27 09:30'), { date: '2026-03-27', time: '09:30' }, 'splitScheduled splits date and time (space)');
    assertEqual(splitScheduled('2026-03-27'), { date: '2026-03-27', time: '' }, 'splitScheduled handles a bare date');
    assertEqual(splitScheduled(''), { date: '', time: '' }, 'splitScheduled handles empty');
    assertEqual(joinScheduled('2026-03-27', '09:30'), '2026-03-27T09:30', 'joinScheduled joins with T');
    assertEqual(joinScheduled('2026-03-27', ''), '2026-03-27', 'joinScheduled omits an empty time');
    assertEqual(joinScheduled('', '09:30'), '', 'joinScheduled is empty without a date (a time alone is meaningless)');

    // --- parseTaskLine still reads scheduled/repeat/created/source/user locally ---
    const detail = parseTaskLine('- [ ] Ping #ToDo [created::2026-09-22] [scheduled::2026-09-23T10:00] [repeat::every week] [source:: wiki/a.md] [user:: A, B]', 'L.md', 1);
    assertEqual([detail?.created, detail?.scheduled, detail?.repeat, detail?.source, detail?.user],
        ['2026-09-22', '2026-09-23T10:00', 'every week', 'wiki/a.md', 'A, B'], 'parseTaskLine exposes the card detail fields');

    // --- re-parenting (mirrors the Go tests in pkg/tasks/subtasks_test.go) ---
    const tree = '# L\n- [ ] A #ToDo\n    - [ ] A1\n        - [ ] A1a\n    - [ ] A2\n- [ ] B #ToDo\n- [ ] C\n- [ ] D\n    - [ ] D1\n';

    // Moving a task stamps [updated::NOW] on its own line only (not its
    // descendants), matching SetParent in pkg/tasks/subtasks.go.
    const r1 = setParentInContent(tree, 7, 2);
    assertEqual(r1?.content, `# L\n- [ ] A #ToDo\n    - [ ] A1\n        - [ ] A1a\n    - [ ] A2\n    - [ ] C [updated::${stamp()}]\n- [ ] B #ToDo\n- [ ] D\n    - [ ] D1\n`,
        'setParentInContent puts C after the last descendant of A, one level deeper');
    assertEqual(r1?.newLine, 6, 'setParentInContent reports the new line');

    const r2 = setParentInContent(tree, 6, 9);
    assertEqual(r2?.content?.includes(`- [ ] D\n    - [ ] D1\n        - [ ] B #ToDo [updated::${stamp()}]\n`), true, 'setParentInContent nests two levels deep when the parent is after the source');
    assertEqual(r2?.newLine, 9, 'setParentInContent reports the line after removing an earlier block');

    const r3 = setParentInContent(tree, 2, 8);
    assertEqual(r3?.content, `# L\n- [ ] B #ToDo\n- [ ] C\n- [ ] D\n    - [ ] D1\n    - [ ] A #ToDo [updated::${stamp()}]\n        - [ ] A1\n            - [ ] A1a\n        - [ ] A2\n`,
        'setParentInContent moves the whole subtree, shifting every level');

    for (const parent of [2, 3, 4, 5]) {
        assertEqual(setParentInContent(tree, 2, parent), null, `setParentInContent rejects a cycle (parent line ${parent})`);
    }
    assertEqual(setParentInContent(tree, 1, 2), null, 'setParentInContent rejects a non-task source');
    assertEqual(setParentInContent(tree, 7, 1), null, 'setParentInContent rejects a non-task parent');

    const pr = promoteInContent(tree, 3);
    assertEqual(pr?.content, `# L\n- [ ] A #ToDo\n    - [ ] A2\n- [ ] A1 [updated::${stamp()}]\n    - [ ] A1a\n- [ ] B #ToDo\n- [ ] C\n- [ ] D\n    - [ ] D1\n`,
        'promoteInContent makes A1 top level after A\'s subtree, bringing A1a along');
    assertEqual(pr?.newLine, 4, 'promoteInContent reports the new line');
    // Already top level: a genuine no-op, so no [updated::] stamp either
    // (mirrors promote()'s early return in pkg/tasks/subtasks.go).
    assertEqual(promoteInContent(tree, 6)?.content, tree, 'promoteInContent leaves a top-level task alone');
    assertEqual(setParentInContent('# L\n- [ ] A\n- [ ] B', 3, 2)?.content, `# L\n- [ ] A\n    - [ ] B [updated::${stamp()}]`, 'setParentInContent keeps a missing trailing newline missing');

    // cross-file: extract from one file, insert into another
    const taken = extractBlock('# L\n- [ ] X #ToDo\n    - [ ] X1\n- [ ] Y\n', 2);
    assertEqual(taken?.rest, '# L\n- [ ] Y\n', 'extractBlock removes the task and its subtasks');
    const placed = insertBlockUnder('# M\n- [ ] P\n- [ ] Q\n', 2, taken?.block ?? [], taken?.indent ?? 0);
    assertEqual(placed?.content, `# M\n- [ ] P\n    - [ ] X #ToDo [updated::${stamp()}]\n        - [ ] X1\n- [ ] Q\n`, 'insertBlockUnder nests the block under the parent in the other file');
    assertEqual(placed?.newLine, 3, 'insertBlockUnder reports the new line');

    // --- foldSubtasks (mirrors KanbanCardsIn) ---
    const mk = (line: number, title: string, level: number, parentLine: number | undefined, tags: string[], status: 'todo' | 'completed' = 'todo') =>
        ({ filePath: 'L.md', lineNum: line, title, status, tags, listName: 'L', level, parentLine });
    const flat = [
        mk(2, 'A', 0, undefined, ['ToDo']),
        mk(3, 'A1', 1, 2, [], 'completed'),
        mk(4, 'A1a', 2, 3, []),
        mk(5, 'A2', 1, 2, ['Tracking']),
        mk(6, 'B', 0, undefined, ['ToDo'])
    ];
    const cards = foldSubtasks(flat);
    assertEqual(cards.map((c) => c.title), ['A', 'B'], 'foldSubtasks: only on-board tasks without an on-board ancestor are cards');
    assertEqual(cards[0]?.subtasks?.map((x) => [x.title, x.level, x.checked]), [['A1', 1, true], ['A1a', 2, false], ['A2', 1, false]],
        'foldSubtasks lists every descendant with its relative level and done state');
    assertEqual(subtaskProgress(cards[0] as never), { done: 1, total: 3 }, 'subtaskProgress counts done over all descendants');
    assertEqual(subtaskProgress(cards[1] as never), null, 'subtaskProgress is null with no subtasks');

    const offBoardParent = foldSubtasks([mk(2, 'Epic', 0, undefined, []), mk(3, 'Child', 1, 2, ['ToDo']), mk(4, 'Grand', 2, 3, [])]);
    assertEqual(offBoardParent.map((c) => c.title), ['Child'], 'foldSubtasks keeps a tagged subtask as a card when its parent is off the board');
    assertEqual(offBoardParent[0]?.subtasks?.map((x) => [x.title, x.level]), [['Grand', 1]], 'foldSubtasks makes Grand a subtask of Child, level 1');

    const topmost = foldSubtasks([mk(2, 'Top', 0, undefined, ['ToDo']), mk(3, 'Mid', 1, 2, ['InProgress']), mk(4, 'Leaf', 2, 3, [])]);
    assertEqual(topmost.map((c) => c.title), ['Top'], 'foldSubtasks: the topmost on-board ancestor owns everything below');
    assertEqual(topmost[0]?.subtasks?.length, 2, 'foldSubtasks: Top owns Mid and Leaf');

    const serverFolded = [{ filePath: 'L.md', lineNum: 2, title: 'A', status: 'todo' as const, tags: ['ToDo'], listName: 'L', subtasks: [{ title: 'x', checked: false, level: 1 }] }];
    assertEqual(foldSubtasks(serverFolded)[0]?.subtasks?.length, 1, 'foldSubtasks passes cards the server already folded straight through');

    // --- addSubtaskInContent ---
    // A new subtask is a new task: it picks up #ToTriage plus
    // [created::]/[updated::], same as stampCreated everywhere else.
    const subtaskTestFile = '- [ ] Buy bread #groceries [due::2026-09-01]\n- [ ] Plain task\n';
    const subtaskAdded = addSubtaskInContent(subtaskTestFile, 1, 'Slice it');
    assertEqual(subtaskAdded.split('\n')[0], '- [ ] Buy bread #groceries [due::2026-09-01]',
        'addSubtaskInContent preserves parent line');
    assertEqual(subtaskAdded.split('\n')[1], `    - [ ] Slice it #ToTriage [created::${today()}] [id::${TEST_ID}] [updated::${stamp()}]`,
        'addSubtaskInContent adds indented subtask checklist line, stamped as a new task');

    assertEqual(KANBAN_STATUSES, ['ToDo', 'InProgress', 'Done', 'Delete'], 'KANBAN_STATUSES matches pkg/tasks and api.ts');

    // --- stampCreated (mirrors stampCreated in pkg/tasks/tasks.go) ---
    assertEqual(stampCreated('No tags here'), `No tags here #ToTriage [created::${today()}] [id::${TEST_ID}] [updated::${stamp()}]`,
        'stampCreated adds #ToTriage plus created/updated when the task has no tag at all');
    assertEqual(stampCreated('Already tagged #ToDo'), `Already tagged #ToDo [created::${today()}] [id::${TEST_ID}] [updated::${stamp()}]`,
        'stampCreated leaves an existing tag alone - no #ToTriage added');
    assertEqual(stampCreated('Explicit date #ToDo [created::2026-01-01]'), `Explicit date #ToDo [created::2026-01-01] [id::${TEST_ID}] [updated::${stamp()}]`,
        "stampCreated keeps a caller-supplied [created::] instead of overwriting it");

    // --- [id::] ---

    assertEqual(stampCreated('Has one #ToDo [created::2026-01-01] [id::keepme0000]'), `Has one #ToDo [created::2026-01-01] [id::keepme0000] [updated::${stamp()}]`,
        'stampCreated keeps a caller-supplied [id::] instead of minting another');
    const withId = '- [ ] Buy milk #ToDo [id::abcdefgh12] [updated::2026-09-29]';
    assertEqual(parseTaskLine(withId, 'Work.md', 1)!.id, 'abcdefgh12', 'parseTaskLine exposes the [id::]');
    assertEqual(parseTaskLine(withId, 'Work.md', 1)!.title, 'Buy milk', 'the [id::] field is not part of the title');
    const movedWithId = setStatusTagInContent(withId, 1, 'InProgress');
    assertEqual([movedWithId.includes('[id::abcdefgh12]'), movedWithId.endsWith(`#InProgress [updated::${stamp()}]`)], [true, true],
        'a later write keeps the [id::] and moves only the stamp');
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add(randomId());
    assertEqual(ids.size, 200, 'random ids do not repeat');
    assertEqual([...ids].every(id => /^[0-9a-hjkmnp-tv-z]{10}$/.test(id)), true, 'ids are 10 Crockford base32 characters');
    assertEqual(newTaskId(), TEST_ID, 'newTaskId goes through idSource');

    // --- nowStamp / [updated::] format ---

    const realNow = clock.now;
    clock.now = () => new Date('2026-10-01T12:56:10.461+01:00');
    assertEqual(nowStamp(), '2026-10-01T11:56:10Z', 'nowStamp is UTC to the second, with no milliseconds');
    assertEqual(setDueDateInContent('- [ ] Old stamp [updated::2026-09-29]', 1, '2026-10-05'),
        '- [ ] Old stamp  [due::2026-10-05] [updated::2026-10-01T11:56:10Z]',
        'a write replaces an old date-only [updated::] with a full timestamp');
    clock.now = realNow;
    const reparsed = parseTaskLine('- [ ] T #ToDo [updated::2026-10-01T11:56:10Z]', 'Work.md', 1)!;
    assertEqual(reparsed.updated, '2026-10-01T11:56:10Z', 'parseTaskLine reads a full [updated::] timestamp back whole');

    // --- matchesFilter ---

    const projectTask = parseTaskLine('- [ ] Do the thing #ToDo #ProjectX', 'Work.md', 1)!;
    assertEqual(matchesFilter(projectTask, []), true, 'empty filter matches everything');
    assertEqual(matchesFilter(projectTask, ['ProjectX']), true, 'matches a tag it carries');
    assertEqual(matchesFilter(projectTask, ['#ProjectX']), true, 'filter tag with a leading # still matches');
    assertEqual(matchesFilter(projectTask, ['projectx']), true, 'matching is case-insensitive');
    assertEqual(matchesFilter(projectTask, ['ProjectY']), false, 'does not match an unrelated tag');
    assertEqual(matchesFilter(projectTask, ['ProjectY', 'ProjectX']), true, 'matches if any filter tag is carried');

    // --- parseBoardFilter / parseBoardColumns / serializeBoardConfig ---

    assertEqual(parseBoardFilter(''), [], 'empty board file has no filter');
    assertEqual(parseBoardFilter('filter: ProjectX, Home Fixes'), ['ProjectX', 'Home Fixes'],
        'parses a comma-separated filter line');
    assertEqual(parseBoardFilter('filter: #ProjectX'), ['ProjectX'], 'strips a leading # from a filtered tag');
    assertEqual(parseBoardFilter('%% some comment %%\nfilter: ProjectX\n'), ['ProjectX'],
        'finds the filter line regardless of other content');
    assertEqual(parseBoardFilter('filter:'), [], 'a blank filter line means no filter');

    assertEqual(parseBoardColumns(''), ['ToDo', 'InProgress', 'Done', 'Delete'], 'no columns line means the default columns');
    assertEqual(parseBoardColumns('columns:'), ['ToDo', 'InProgress', 'Done', 'Delete'], 'a blank columns line also means the default');
    assertEqual(parseBoardColumns('columns: Backlog, InReview, Shipped'), ['Backlog', 'InReview', 'Shipped'],
        'parses a custom comma-separated column line, order preserved');
    assertEqual(parseBoardColumns('filter: ProjectX\ncolumns: Backlog, Done'), ['Backlog', 'Done'],
        'columns and filter lines are parsed independently');

    const roundTrip = parseBoardFilter(serializeBoardConfig(['ProjectX', 'Home Fixes'], []));
    assertEqual(roundTrip, ['ProjectX', 'Home Fixes'], 'serializeBoardConfig round-trips the filter through parseBoardFilter');
    const roundTripEmpty = parseBoardFilter(serializeBoardConfig([], []));
    assertEqual(roundTripEmpty, [], 'serializeBoardConfig round-trips an empty filter');

    const columnsRoundTrip = parseBoardColumns(serializeBoardConfig([], ['Backlog', 'InReview', 'Shipped']));
    assertEqual(columnsRoundTrip, ['Backlog', 'InReview', 'Shipped'],
        'serializeBoardConfig round-trips custom columns through parseBoardColumns');
    const columnsRoundTripDefault = parseBoardColumns(serializeBoardConfig([], []));
    assertEqual(columnsRoundTripDefault, ['ToDo', 'InProgress', 'Done', 'Delete'],
        'serializeBoardConfig with no columns round-trips to the default columns');

    // --- columnLabel ---

    assertEqual(columnLabel('ToDo'), 'To Do', 'reproduces the existing "To Do" label');
    assertEqual(columnLabel('InProgress'), 'In Progress', 'reproduces the existing "In Progress" label');
    assertEqual(columnLabel('Done'), 'Done', 'reproduces the existing "Done" label');
    assertEqual(columnLabel('Backlog'), 'Backlog', 'a plain custom tag is used as-is');
    assertEqual(columnLabel('code_review'), 'Code review', 'underscores become spaces');
    assertEqual(columnLabel('inReview'), 'In Review', 'splits a camelCase boundary even without a leading capital');

    // --- noteTitleFromTask ---

    assertEqual(noteTitleFromTask('Buy milk'), 'Buy milk', 'leaves a safe title unchanged');
    assertEqual(noteTitleFromTask('Fix "the" thing?/*'), 'Fix the thing', 'strips filesystem-unsafe characters');
    assertEqual(noteTitleFromTask('   '), 'Untitled note', 'falls back to "Untitled note" when empty after cleaning');
    assertEqual(noteTitleFromTask('x'.repeat(100)).length, 80, 'truncates long titles to 80 chars');

    // --- addNoteLinkToContent ---

    const linkFile = '# Work\n\n- [ ] Buy milk #groceries #ToDo [due::2026-08-20]\n- [ ] Bare task\n';

    const linked = addNoteLinkToContent(linkFile, 3, 'Groceries Plan');
    assertEqual(linked.split('\n')[2], `- [ ] Buy milk   [[Groceries Plan]] #groceries #ToDo [due::2026-08-20] [updated::${stamp()}]`,
        'inserts the note link right after the title, before tags/fields, and stamps [updated::]');

    const linkedBare = addNoteLinkToContent(linkFile, 4, 'Some Note');
    assertEqual(linkedBare.split('\n')[3], `- [ ] Bare task   [[Some Note]] [updated::${stamp()}]`,
        'appends cleanly to a task with no tags/fields');

    const linkedOutOfRange = addNoteLinkToContent(linkFile, 99, 'Some Note');
    assertEqual(linkedOutOfRange, linkFile, 'is a no-op for an out-of-range line number');

    // --- extractWikilink ---

    assertEqual(extractWikilink('Buy milk   [[Groceries Plan]] #groceries'), 'Groceries Plan',
        'extracts the wikilink target from a title');
    assertEqual(extractWikilink('Buy milk #groceries'), null, 'null when there is no wikilink');
    assertEqual(extractWikilink('Two links [[First]] [[Second]]'), 'First', 'takes the first wikilink when there are several');

    // --- project links and the project filter ---

    assertEqual(replaceWikilink('Book flights   [[Old Trip]]', 'New Trip'), 'Book flights   [[New Trip]]',
        'replaceWikilink swaps the existing link in place');
    assertEqual(replaceWikilink('Book flights   [[Old Trip]] soon', null), 'Book flights soon',
        'replaceWikilink removes the link and its leading space');
    assertEqual(replaceWikilink('Book flights', 'New Trip'), 'Book flights   [[New Trip]]',
        'replaceWikilink appends a link when there is none');
    assertEqual(replaceWikilink('Book flights', null), 'Book flights',
        'replaceWikilink leaves a title with no link alone when removing');

    const projLines = '# Notes\n- [ ] Book flights   [[Old Trip]] #ToDo [due::2026-09-01] [id::7k3m9x2qhd] [updated::2026-01-01T00:00:00Z]\n- [ ] Plain task #ToDo\n';
    const swapped = setProjectLinkInContent(projLines, 2, 'New Trip');
    assert(swapped.includes('- [ ] Book flights   [[New Trip]] #ToDo [due::2026-09-01] [id::7k3m9x2qhd] [updated::'),
        'setProjectLinkInContent swaps the project link and keeps the other fields in place');
    assert(!swapped.includes('[[Old Trip]]'), 'setProjectLinkInContent drops the old project link');
    assert(!/\[updated::2026-01-01T00:00:00Z\]/.test(swapped), 'setProjectLinkInContent re-stamps [updated::]');
    assertEqual(setProjectLinkInContent(projLines, 2, null).split('\n')[1]!.replace(/ \[updated::[^\]]*\]$/, ''),
        '- [ ] Book flights #ToDo [due::2026-09-01] [id::7k3m9x2qhd]',
        'setProjectLinkInContent with null removes the project link');
    assertEqual(setProjectLinkInContent(projLines, 3, 'Trip').split('\n')[2]!.replace(/ \[updated::[^\]]*\]$/, ''),
        '- [ ] Plain task   [[Trip]] #ToDo',
        'setProjectLinkInContent inserts a link before the tags when a task has none');
    assertEqual(setProjectLinkInContent(projLines, 3, null), projLines,
        'setProjectLinkInContent with null on an unlinked task changes nothing');
    assertEqual(setProjectLinkInContent(projLines, 1, 'Trip'), projLines,
        'setProjectLinkInContent is a no-op on a non-task line');
    assertEqual(setProjectLinkInContent(projLines, 99, 'Trip'), projLines,
        'setProjectLinkInContent is a no-op for an out-of-range line');

    const projects = ['Center Parcs Trip', 'Home Fixes'];
    assertEqual(taskProject({ title: 'Book   [[center parcs trip]]' }, projects), 'Center Parcs Trip',
        'taskProject matches the project name case-insensitively');
    assertEqual(taskProject({ title: 'Read   [[Some Article]]' }, projects), null,
        'taskProject is null for a link to a note that is not a project');
    assertEqual(taskProject({ title: 'No link here' }, projects), null,
        'taskProject is null when the task has no link');

    const linkedTask = { title: 'Book   [[Home Fixes]]' } as Parameters<typeof matchesProjectFilter>[0];
    const bareTask = { title: 'Buy milk' } as Parameters<typeof matchesProjectFilter>[0];
    assert(matchesProjectFilter(linkedTask, '', projects), 'a blank project filter matches every task');
    assert(matchesProjectFilter(linkedTask, 'Home Fixes', projects), 'a project filter matches its own tasks');
    assert(!matchesProjectFilter(linkedTask, 'Center Parcs Trip', projects), 'a project filter hides other projects');
    assert(!matchesProjectFilter(linkedTask, BOARD_NO_PROJECT, projects), 'the no-project filter hides linked tasks');
    assert(matchesProjectFilter(bareTask, BOARD_NO_PROJECT, projects), 'the no-project filter shows unlinked tasks');
    assert(matchesProjectFilter({ title: 'Read   [[Some Article]]' } as Parameters<typeof matchesProjectFilter>[0], BOARD_NO_PROJECT, projects),
        'the no-project filter shows tasks linked only to a non-project note');

    assert(isProjectNote({ tags: 'Project' }), 'a note tagged Project (string) is a project');
    assert(isProjectNote({ tags: ['#project', 'Work'] }), 'a note tagged Project (list, #, any case) is a project');
    assert(!isProjectNote({ tags: 'Projects-archive' }), 'a similar but different tag is not a project');
    assert(!isProjectNote({ tags: 'Work' }) && !isProjectNote(undefined), 'a note without the tag is not a project');

    assertEqual(boardProjectOptions(['A', 'B'], '').map((o) => o.value), ['', BOARD_NO_PROJECT, 'A', 'B'],
        'project dropdown offers all, none, then each project');
    assertEqual(boardProjectOptions(['A'], 'Gone').map((o) => o.value), ['', BOARD_NO_PROJECT, 'A', 'Gone'],
        'project dropdown keeps a saved project that no longer exists');

    assertEqual(parseBoardProject(serializeBoardConfig([], [], 'Home Fixes')), 'Home Fixes',
        'serializeBoardConfig round-trips the project through parseBoardProject');
    assertEqual(parseBoardProject(serializeBoardConfig([], [], BOARD_NO_PROJECT)), BOARD_NO_PROJECT,
        'the no-project choice round-trips');
    assertEqual(parseBoardProject(serializeBoardConfig(['urgent'], [])), '',
        'a board with no project serializes with no project line');
    assertEqual(serializeBoardConfig(['urgent'], []).includes('\nproject:'), false,
        'a board with no project keeps the same file layout as before');
    assertEqual(parseBoardFilter(serializeBoardConfig(['urgent'], [], 'Home Fixes')), ['urgent'],
        'the project line does not disturb the filter line');

    console.debug('\nAll taskModel checks passed.');
}

run();
