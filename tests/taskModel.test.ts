import {
    parseTaskLine,
    kanbanStatus,
    filterKanban,
    setStatusTagInContent,
    KANBAN_STATUSES,
    matchesFilter,
    parseBoardFilter,
    parseBoardColumns,
    serializeBoardConfig,
    columnLabel,
    noteTitleFromTask,
    addNoteLinkToContent,
    extractWikilink
} from '../src/taskModel';

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

    // Custom columns: only the board's own tags get stripped, and only a
    // column literally named "Done" (case-insensitive) completes the task.
    const customFile = '- [ ] Ship it #Backlog\n';
    const toShipped = setStatusTagInContent(customFile, 1, 'Shipped', ['Backlog', 'InReview', 'Shipped']);
    assertEqual(toShipped.trimEnd(), '- [ ] Ship it #Shipped', 'moves within a custom column set, no #Done involved');

    const toDoneCustom = setStatusTagInContent(customFile, 1, 'done', ['Backlog', 'InReview', 'done']);
    assertEqual(toDoneCustom.trimEnd(), '- [x] Ship it #done', 'a custom column literally named "done" (any case) still completes the task');

    const leavesOtherTags = setStatusTagInContent('- [ ] Ship it #Backlog #urgent\n', 1, 'InReview', ['Backlog', 'InReview']);
    assertEqual(leavesOtherTags.trimEnd(), '- [ ] Ship it  #urgent #InReview',
        "only the board's own column tags are stripped - a non-column tag like #urgent is left alone");

    assertEqual(KANBAN_STATUSES, ['ToDo', 'InProgress', 'Done'], 'KANBAN_STATUSES matches pkg/tasks and api.ts');

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

    assertEqual(parseBoardColumns(''), ['ToDo', 'InProgress', 'Done'], 'no columns line means the default columns');
    assertEqual(parseBoardColumns('columns:'), ['ToDo', 'InProgress', 'Done'], 'a blank columns line also means the default');
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
    assertEqual(columnsRoundTripDefault, ['ToDo', 'InProgress', 'Done'],
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
    assertEqual(linked.split('\n')[2], '- [ ] Buy milk   [[Groceries Plan]] #groceries #ToDo [due::2026-08-20]',
        'inserts the note link right after the title, before tags/fields');

    const linkedBare = addNoteLinkToContent(linkFile, 4, 'Some Note');
    assertEqual(linkedBare.split('\n')[3], '- [ ] Bare task   [[Some Note]]',
        'appends cleanly to a task with no tags/fields');

    const linkedOutOfRange = addNoteLinkToContent(linkFile, 99, 'Some Note');
    assertEqual(linkedOutOfRange, linkFile, 'is a no-op for an out-of-range line number');

    // --- extractWikilink ---

    assertEqual(extractWikilink('Buy milk   [[Groceries Plan]] #groceries'), 'Groceries Plan',
        'extracts the wikilink target from a title');
    assertEqual(extractWikilink('Buy milk #groceries'), null, 'null when there is no wikilink');
    assertEqual(extractWikilink('Two links [[First]] [[Second]]'), 'First', 'takes the first wikilink when there are several');

    console.debug('\nAll taskModel checks passed.');
}

run();
