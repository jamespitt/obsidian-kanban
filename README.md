# Kanban Board

A Kanban board for Obsidian that reads and writes your **real tasks** - no separate board file, no bespoke format. It's a native-plugin twin of the Kanban view in `task-front-end` (the companion web app) and the `Kanban` tab in `task_viewer.py` (the TUI): all three read and write the exact same markdown convention, so a task moved on one shows up moved on the others.

## How it works

- **One global board**, not a file type you create. Open it via the ribbon icon or the **Open board** command.
- **Columns are fixed**: To Do / In Progress / Done. A task is on the board if it carries one of the `#ToDo`, `#InProgress`, `#Done` tags (case-insensitive) - anywhere in the configured task folder. Untagged tasks simply don't appear.
- **Cards are your actual task lines** - `- [ ] Buy milk #ToDo [due::2026-08-20]` - parsed the same way `notesmd-cli`'s server and `task_viewer.py` parse them: `[due::...]`, `[scheduled::...]`, `[priority::...]`, `[repeat::...]`, and any other `#tag`.
- **Moving a card** (drag-and-drop, or the `← / →` buttons on each card) swaps the status tag in place and keeps completion in sync: moving onto **Done** checks the task off; moving off it un-checks it. Every other tag and field on the line is left untouched.
- **Clicking a card** opens its source file at that line, so you can edit anything else about it (title, due date, other tags, add a subtask, ...) the normal way.
- The board refreshes automatically when files change - including edits made from `task-front-end`, `task_viewer.py`, or anywhere else, since they're all editing the same lines.

## Settings

- **Task folder**: the vault-relative folder to scan for tasks (recursively). Leave blank to scan the whole vault.

## What this plugin intentionally doesn't do

This used to be a general-purpose, multi-board Kanban plugin with custom lanes, sub-lanes, per-board priority colors, and its own `.kanban` file format. That's gone in favor of matching the shared task system exactly - see `AGENTS.md` for the project's development conventions. If you have old `.kanban` files from a previous version, they're untouched (still plain markdown) but this plugin no longer opens them as boards.

If you want richer card editing (full edit modal, general tag add/remove, adding subtasks) from a board view specifically rather than by opening the source file, that's exactly what `task-front-end`'s Kanban tab already does - this plugin deliberately stays focused on the board itself.
