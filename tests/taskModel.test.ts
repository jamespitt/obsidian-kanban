import { parseTaskLine, kanbanStatus, filterKanban, setStatusTagInContent, KANBAN_STATUSES } from '../src/taskModel';

function assertEqual(actual: unknown, expected: unknown, label: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
    console.debug(`ok - ${label}`);
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

    const t2 = parseTaskLine('    - [x] Done thing #Done', 'Work.md', 5);
    if (!t2) throw new Error('FAIL: expected a task, got null');
    assertEqual(t2.status, 'completed', 'parses checked status');

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

    // --- setStatusTagInContent ---

    const file = '# Work\n\n- [ ] Buy milk #groceries #ToDo [due::2026-08-20]\n- [ ] Other task\n';

    // Matches pkg/tasks.go's SetStatusTag exactly: the removed tag leaves an
    // internal double space (only trimmed at the ends), and the new status
    // tag is appended at the end rather than reinserted in its old spot.
    const moved = setStatusTagInContent(file, 3, 'InProgress');
    const movedLines = moved.split('\n');
    assertEqual(movedLines[2], '- [ ] Buy milk #groceries  [due::2026-08-20] #InProgress',
        'setStatusTagInContent swaps the tag, keeps other tags/fields, keeps checkbox unchecked');

    const completed = setStatusTagInContent(file, 3, 'Done');
    const completedLines = completed.split('\n');
    assertEqual(completedLines[2], '- [x] Buy milk #groceries  [due::2026-08-20] #Done',
        'setStatusTagInContent checks the box when moving to Done');

    const removed = setStatusTagInContent(file, 3, null);
    const removedLines = removed.split('\n');
    assertEqual(removedLines[2], '- [ ] Buy milk #groceries  [due::2026-08-20]',
        'setStatusTagInContent removes the status tag entirely when given null');

    const untouched = setStatusTagInContent(file, 4, 'ToDo');
    assertEqual(untouched.split('\n')[3], '- [ ] Other task #ToDo', 'targets only the given line');

    const outOfRange = setStatusTagInContent(file, 99, 'ToDo');
    assertEqual(outOfRange, file, 'is a no-op for an out-of-range line number');

    const uncheckedFromDone = setStatusTagInContent('- [x] Done item #Done\n', 1, 'ToDo');
    assertEqual(uncheckedFromDone.trimEnd(), '- [ ] Done item #ToDo', 'un-checks the box when moving off Done');

    assertEqual(KANBAN_STATUSES, ['ToDo', 'InProgress', 'Done'], 'KANBAN_STATUSES matches pkg/tasks and api.ts');

    console.debug('\nAll taskModel checks passed.');
}

run();
