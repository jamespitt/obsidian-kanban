# Kanban Board

A Kanban board for Obsidian that reads and writes your **real tasks** - no separate board file format, no bespoke card storage. It's a native-plugin twin of the Kanban view in `task-front-end` (the companion web app) and the `Kanban` tab in `task_viewer.py` (the TUI): all three read and write the exact same markdown convention, so a task moved on one shows up moved on the others.

## How it works

- **A board is a `.kanban` file** - like the original version of this plugin, opening one shows the board view instead of raw markdown. Use the ribbon icon or the **Create new board** command to make one; it lives in your vault like any other file, so you can place it in a folder, link to it (`[[My Board]]`), or navigate to it from the file explorer.
- **A board's file content is just its filter, never task data.** Each board optionally scopes itself to tasks carrying one or more given tags (e.g. `ProjectX`), set when you create the board or edited later via the **Edit filter** button in the board's header. Leave it blank to show every task in scope. The actual cards always come live from your real task files - nothing is duplicated into the board file.
- **Columns are fixed**: To Do / In Progress / Done. A task is on the board if it carries one of the `#ToDo`, `#InProgress`, `#Done` tags (case-insensitive) - anywhere in the configured task folder, and matching the board's filter (if any). Untagged tasks simply don't appear.
- **Cards are your actual task lines** - `- [ ] Buy milk #ToDo [due::2026-08-20]` - parsed the same way `notesmd-cli`'s server and `task_viewer.py` parse them: `[due::...]`, `[scheduled::...]`, `[priority::...]`, `[repeat::...]`, and any other `#tag`.
- **Moving a card** (drag-and-drop, or the `← / →` buttons on each card) swaps the status tag in place and keeps completion in sync: moving onto **Done** checks the task off; moving off it un-checks it. Every other tag and field on the line is left untouched.
- **Clicking a card** opens its source file at that line, so you can edit anything else about it (title, due date, other tags, add a subtask, ...) the normal way.
- **Right-clicking a card** without a linked note offers **Create note from card**: makes a new note (title derived from the task, optionally from a template - see Settings; empty content otherwise, since the filename is already the note's title in Obsidian's own UI), and links the task to it by inserting `[[Note Title]]` right after the task's title text - the same `Title   [[Project Note]]` convention already used throughout the vault. The task line's tags and fields are otherwise untouched. Once a card has a linked note, the same menu item becomes **Open linked note** instead, and a `📄 Note Title` button appears in the card's meta row for the same purpose - both resolve the link the way Obsidian itself would (not just a basename guess), and offer to recreate it if it's since gone missing.
- Every open board refreshes automatically when files change - including edits made from `task-front-end`, `task_viewer.py`, or anywhere else, since they're all editing the same lines.

## Settings

- **Task folder**: the vault-relative folder to scan for tasks (recursively). Leave blank to scan the whole vault. This scopes every board; a board's own filter narrows further, by tag, within that scope.
- **New note folder** / **New note template**: where "Create note from card" places new notes, and an optional template file for their starting content.

## What this plugin intentionally doesn't do

This used to be a general-purpose, multi-board Kanban plugin with custom lanes, sub-lanes, per-board priority colors, and its own bespoke `.kanban` card format. The card format is gone in favor of matching the shared task system exactly - boards are file-based again (like the very first version), but a board file only ever holds a tag filter, never card content. If you have `.kanban` files from the old bespoke-card-format version, opening them won't error, but their old content is inert - the board that opens is always driven by your real, live-tagged tasks, not anything written in the file itself. See `AGENTS.md` for the project's development conventions.

If you want richer card editing (full edit modal, general tag add/remove, adding subtasks) from a board view specifically rather than by opening the source file, that's exactly what `task-front-end`'s Kanban tab already does - this plugin deliberately stays focused on the board itself.
