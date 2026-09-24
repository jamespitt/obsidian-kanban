import { TextFileView, WorkspaceLeaf, TFile, Notice, Menu, debounce, Debouncer, setIcon } from 'obsidian';
import KanbanPlugin from './main';
import { EditBoardModal } from './EditBoardModal';
import {
    Task,
    KanbanStatus,
    KANBAN_STATUSES,
    parseTaskLine,
    kanbanStatus,
    filterKanban,
    matchesFilter,
    setStatusTagInContent,
    applyKanbanStatus,
    sameColumns,
    parseBoardFilter,
    parseBoardColumns,
    serializeBoardConfig,
    columnLabel,
    noteTitleFromTask,
    addNoteLinkToContent,
    extractWikilink,
    setDueDateInContent,
    addSubtaskInContent
} from './taskModel';
import { DueDatePickerModal } from './DueDatePickerModal';
import { AddTaskModal } from './AddTaskModal';
import { AddSubtaskModal } from './AddSubtaskModal';
import { ApiConfig, apiTaskToTask, fetchKanbanTasks, fetchNote, renameTask, setKanbanStatus } from './apiClient';
import { obsidianRequest } from './obsidianRequest';
import { RemoteNoteModal } from './RemoteNoteModal';

export const KANBAN_VIEW_TYPE = 'kanban-board-view';

/**
 * A board over the vault's real tasks, driven by tag columns - by default
 * #ToDo/#InProgress/#Done, the same convention task_viewer.py (TUI) and
 * task-front-end (web) use, though a board can define its own column set
 * instead (see taskModel's parseBoardColumns) - that necessarily only
 * shows up here, since the other two tools only know the default three. A
 * board is a `.kanban` file, like the original version of this plugin, but
 * its content is only ever a tag filter and column list (see taskModel's
 * parseBoardFilter/parseBoardColumns/serializeBoardConfig) - never task
 * data. Tasks always live in, and are edited in place in, their real
 * source files; a board is just a saved, reopenable view over a subset of
 * them.
 */
export class KanbanView extends TextFileView {
    private static readonly API_POLL_INTERVAL_MS = 30_000;

    plugin: KanbanPlugin;
    private tasks: Task[] = [];
    private filterTags: string[] = [];
    private columns: string[] = [...KANBAN_STATUSES];
    private draggedTask: Task | null = null;
    private scannedFiles: TFile[] = [];
    private scheduleRefresh: Debouncer<[], void>;

    /** True when this board reads/writes via notesmd-cli serve's HTTP API instead of local vault files. */
    private apiMode(): boolean {
        return this.plugin.settings.serverUrl.trim().length > 0;
    }

    private apiConfig(): ApiConfig {
        const s = this.plugin.settings;
        return {
            serverUrl: s.serverUrl.trim().replace(/\/+$/, ''),
            username: s.username,
            password: s.password,
            vaultId: s.vaultId.trim()
        };
    }

    constructor(leaf: WorkspaceLeaf, plugin: KanbanPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.icon = 'layout-grid';
        this.scheduleRefresh = debounce(() => { void this.refreshTasks(); }, 400, true);
    }

    getViewType(): string {
        return KANBAN_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename ?? 'Kanban board';
    }

    getViewData(): string {
        const usingDefaultColumns = sameColumns(this.columns, KANBAN_STATUSES);
        return serializeBoardConfig(this.filterTags, usingDefaultColumns ? [] : this.columns);
    }

    setViewData(data: string, _clear: boolean): void {
        this.filterTags = parseBoardFilter(data);
        this.columns = parseBoardColumns(data);
        void this.refreshTasks();
    }

    clear(): void {
        this.tasks = [];
        this.filterTags = [];
        this.columns = [...KANBAN_STATUSES];
    }

    async onOpen(): Promise<void> {
        this.registerEvent(this.app.vault.on('modify', (f) => {
            if (f instanceof TFile && f.path === this.file?.path) return;
            this.scheduleRefresh();
        }));
        this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
        this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
        this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));

        // Vault events above don't fire for changes made purely server-side
        // (e.g. from another device, or task-front-end), so API-mode boards
        // also poll, plus refresh immediately when the leaf becomes active -
        // covering the common "switch back to the board tab" case without
        // waiting out the interval.
        if (this.apiMode()) {
            this.registerInterval(window.setInterval(() => { void this.refreshTasks(); }, KanbanView.API_POLL_INTERVAL_MS));
        }
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (leaf === this.leaf && this.apiMode()) void this.refreshTasks();
        }));

        this.addAction('refresh-cw', 'Refresh', () => { void this.refreshTasks(); });
        this.addAction('filter', 'Edit board (filter/columns)', () => this.editBoard());
    }

    async onClose(): Promise<void> {
        this.scheduleRefresh.cancel();
    }

    /** Public entry point for external callers (e.g. the settings tab) to force a rescan. */
    async refresh(): Promise<void> {
        await this.refreshTasks();
    }

    private async refreshTasks(): Promise<void> {
        this.tasks = await this.scanTasks();
        this.render();
    }

    private listCandidateFiles(): TFile[] {
        const folder = this.plugin.settings.taskFolder.trim().replace(/^\/+|\/+$/g, '');
        return this.app.vault.getMarkdownFiles().filter((f) => {
            if (!folder) return true;
            return f.path === `${folder}.md` || f.path.startsWith(`${folder}/`);
        });
    }

    private async scanTasks(): Promise<Task[]> {
        // Local file listing always runs regardless of mode - it feeds
        // openAddTaskModal's destination picker, which stays local-only in
        // both modes (see view.ts's "Left local-only in v1" scope note).
        this.scannedFiles = this.listCandidateFiles();
        return this.apiMode() ? this.scanTasksViaApi() : this.scanTasksLocal(this.scannedFiles);
    }

    private async scanTasksViaApi(): Promise<Task[]> {
        try {
            const apiTasks = await fetchKanbanTasks(obsidianRequest, this.apiConfig(), this.columns);
            return apiTasks.map(apiTaskToTask);
        } catch (e) {
            new Notice(`Kanban: couldn't reach the server (${e instanceof Error ? e.message : String(e)}) - showing the last known list.`);
            return this.tasks; // keep the last good list rather than clearing the board
        }
    }

    private async scanTasksLocal(files: TFile[]): Promise<Task[]> {
        const tasks: Task[] = [];
        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line === undefined) continue;
                const task = parseTaskLine(line, file.path, i + 1);
                if (task) {
                    const parentIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
                    const subtasks: { title: string; checked: boolean }[] = [];
                    
                    let j = i + 1;
                    while (j < lines.length) {
                        const nextLine = lines[j];
                        if (nextLine === undefined) break;
                        
                        const nextIndentMatch = nextLine.match(/^(\s*)/);
                        const nextIndent = nextIndentMatch?.[1]?.length ?? 0;
                        
                        if (nextLine.trim() !== '') {
                            if (nextIndent <= parentIndent) {
                                break;
                            }
                            
                            const subMatch = /^(\s*)-\s*\[([xX ])\]\s+(.*)$/.exec(nextLine);
                            if (subMatch) {
                                const checked = subMatch[2]?.toLowerCase() === 'x';
                                const title = subMatch[3]?.trim() ?? '';
                                subtasks.push({ title, checked });
                            }
                        }
                        j++;
                    }
                    task.subtasks = subtasks;
                    tasks.push(task);
                }
            }
        }
        return tasks;
    }

    private editBoard(): void {
        const usingDefaultColumns = sameColumns(this.columns, KANBAN_STATUSES);
        new EditBoardModal(
            this.app,
            this.filterTags.join(', '),
            usingDefaultColumns ? '' : this.columns.join(', '),
            (filterInput, columnsInput) => {
                this.filterTags = filterInput.split(',').map((t) => t.trim().replace(/^#/, '')).filter((t) => t.length > 0);
                const customColumns = columnsInput.split(',').map((t) => t.trim().replace(/^#/, '')).filter((t) => t.length > 0);
                this.columns = customColumns.length > 0 ? customColumns : [...KANBAN_STATUSES];
                this.requestSave();
                this.render();
            }
        ).open();
    }

    private render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('kanban-board-container');

        const board = filterKanban(this.tasks, this.columns).filter((t) => matchesFilter(t, this.filterTags));
        const columns: Record<string, Task[]> = {};
        for (const c of this.columns) columns[c] = [];
        for (const task of board) {
            const status = kanbanStatus(task, this.columns);
            if (status) columns[status]?.push(task);
        }

        if (this.filterTags.length > 0) {
            const filterEl = container.createDiv({ cls: 'kanban-board-filter' });
            filterEl.setText(`Filtered to: ${this.filterTags.map((t) => `#${t}`).join(', ')}`);
        }

        const boardEl = container.createDiv({ cls: 'kanban-columns' });

        for (const status of this.columns) {
            const colEl = boardEl.createDiv({ cls: 'kanban-column' });

            const headerEl = colEl.createDiv({ cls: 'kanban-column-header' });
            headerEl.createSpan({ cls: 'kanban-column-title', text: columnLabel(status) });
            headerEl.createSpan({ cls: 'kanban-column-count', text: String(columns[status]?.length ?? 0) });

            const bodyEl = colEl.createDiv({ cls: 'kanban-column-body' });
            bodyEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                bodyEl.addClass('kanban-column-body--dragover');
            });
            bodyEl.addEventListener('dragleave', () => {
                bodyEl.removeClass('kanban-column-body--dragover');
            });
            bodyEl.addEventListener('drop', (e) => {
                e.preventDefault();
                bodyEl.removeClass('kanban-column-body--dragover');
                if (this.draggedTask) {
                    void this.moveTask(this.draggedTask, status);
                    this.draggedTask = null;
                }
            });

            if ((columns[status]?.length ?? 0) === 0) {
                bodyEl.createDiv({ cls: 'kanban-empty', text: 'No tasks' });
            }

            for (const task of columns[status] ?? []) {
                this.renderCard(bodyEl, task, status);
            }

            const addBtn = colEl.createEl('button', { cls: 'kanban-column-add-btn', text: 'Add task' });
            addBtn.addEventListener('click', () => {
                this.openAddTaskModal(status);
            });
        }
    }

    private renderCard(parent: HTMLElement, task: Task, status: KanbanStatus): void {
        const cardEl = parent.createDiv({ cls: 'kanban-card' });
        if (task.status === 'completed') cardEl.addClass('kanban-card--completed');
        cardEl.setAttr('draggable', 'true');

        // Quick Actions (Done and Delete buttons in the top-right corner on
        // hover) - only offered when that column genuinely exists on this
        // board. Moving onto a tag that isn't one of the board's own columns
        // would write it to the file but the card would then match none of
        // this.columns and simply vanish from every column (in API mode, the
        // server rejects it outright, since kanban_status must be one of the
        // given kanban_columns) - so don't offer an action that can't work.
        const quickActionsEl = cardEl.createDiv({ cls: 'kanban-card-quick-actions' });

        const doneCol = this.columns.find(c => c.toLowerCase() === 'done');
        if (doneCol) {
            const doneBtn = quickActionsEl.createEl('button', { cls: 'kanban-card-quick-btn kanban-card-quick-done', attr: { title: 'Mark done' } });
            setIcon(doneBtn, 'check');
            doneBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.moveTask(task, doneCol);
            });
        }

        const deleteCol = this.columns.find(c => c.toLowerCase() === 'delete');
        if (deleteCol) {
            const deleteBtn = quickActionsEl.createEl('button', { cls: 'kanban-card-quick-btn kanban-card-quick-delete', attr: { title: 'Mark delete' } });
            setIcon(deleteBtn, 'trash');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.moveTask(task, deleteCol);
            });
        }

        cardEl.addEventListener('dragstart', (e) => {
            this.draggedTask = task;
            cardEl.addClass('kanban-card--dragging');
            e.dataTransfer?.setData('text/plain', `${task.filePath}:${task.lineNum}`);
        });
        cardEl.addEventListener('dragend', () => {
            cardEl.removeClass('kanban-card--dragging');
        });
        cardEl.addEventListener('click', () => {
            void this.openTaskSource(task);
        });
        const linkedNote = extractWikilink(task.title);

        cardEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const menu = new Menu();
            if (linkedNote) {
                menu.addItem((item) => {
                    item.setTitle('Open linked note')
                        .setIcon('file-text')
                        .onClick(() => { void this.openLinkedNote(task, linkedNote); });
                });
            } else {
                menu.addItem((item) => {
                    item.setTitle('Create note from card')
                        .setIcon('file-plus')
                        .onClick(() => { void this.createNoteFromCard(task); });
                });
            }
            menu.addItem((item) => {
                item.setTitle(task.due ? 'Edit due date' : 'Set due date')
                    .setIcon('calendar')
                    .onClick(() => {
                        new DueDatePickerModal(this.app, task.due || '', (date) => {
                            void this.setTaskDueDate(task, date);
                        }).open();
                    });
            });
            menu.addItem((item) => {
                item.setTitle('Add subtask')
                    .setIcon('plus')
                    .onClick(() => {
                        this.openAddSubtaskModal(task);
                    });
            });
            menu.addItem((item) => {
                item.setTitle('Open source')
                    .setIcon('file-text')
                    .onClick(() => { void this.openTaskSource(task); });
            });
            menu.showAtMouseEvent(e);
        });

        cardEl.createDiv({ cls: 'kanban-card-title', text: task.title });

        if (task.subtasks && task.subtasks.length > 0) {
            const subtasksEl = cardEl.createDiv({ cls: 'kanban-card-subtasks' });
            for (const sub of task.subtasks) {
                const subEl = subtasksEl.createDiv({ cls: 'kanban-card-subtask' });
                const checkIcon = sub.checked ? '☑' : '☐';
                const subText = subEl.createSpan({ text: `${checkIcon} ${sub.title}` });
                if (sub.checked) {
                    subText.addClass('kanban-card-subtask--completed');
                }
            }
        }

        const otherTags = task.tags.filter((t) => t.toLowerCase() !== status.toLowerCase());
        if (task.listName || task.due || task.priority || otherTags.length > 0 || linkedNote || task.source || task.user || task.created) {
            const metaEl = cardEl.createDiv({ cls: 'kanban-card-meta' });
            if (linkedNote) {
                const noteBtn = metaEl.createEl('button', { cls: 'kanban-card-note', attr: { title: linkedNote } });
                setIcon(noteBtn.createSpan(), 'file-text');
                noteBtn.createSpan({ text: 'Linked note' });
                noteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    void this.openLinkedNote(task, linkedNote);
                });
            }
            if (task.source) {
                const sourceBtn = metaEl.createEl('button', { cls: 'kanban-card-source', attr: { title: task.source } });
                setIcon(sourceBtn.createSpan(), 'link');
                const sourceName = task.source.split('/').pop()?.replace(/\.md$/i, '') ?? task.source;
                sourceBtn.createSpan({ text: sourceName });
                sourceBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    void this.openLinkedNote(task, task.source!);
                });
            }
            if (task.user) {
                const users = task.user.split(',').map((u) => u.trim()).filter(Boolean);
                for (const u of users) {
                    const userBtn = metaEl.createEl('button', { cls: 'kanban-card-user', attr: { title: u } });
                    setIcon(userBtn.createSpan(), 'user');
                    userBtn.createSpan({ text: u });
                    userBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        void this.openLinkedNote(task, u);
                    });
                }
            }
            if (task.created) {
                const createdEl = metaEl.createSpan({ cls: 'kanban-card-created', attr: { title: `Created: ${task.created}` } });
                setIcon(createdEl.createSpan(), 'calendar-days');
                createdEl.createSpan({ text: `Created: ${task.created.slice(0, 10)}` });
            }
            if (task.listName) metaEl.createSpan({ cls: 'kanban-card-list', text: task.listName });
            if (task.due) {
                const dueBtn = metaEl.createEl('button', { cls: 'kanban-card-due-btn', attr: { title: 'Edit due date' } });
                dueBtn.createSpan({ text: `\u{1F4C5} ${task.due}` });
                dueBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    new DueDatePickerModal(this.app, task.due || '', (date) => {
                        void this.setTaskDueDate(task, date);
                    }).open();
                });
            }
            if (task.priority) metaEl.createSpan({ cls: 'kanban-card-priority', text: `↑ ${task.priority}` });
            for (const tag of otherTags) {
                metaEl.createSpan({ cls: 'kanban-card-tag', text: `#${tag}` });
            }
        }

        const moveEl = cardEl.createDiv({ cls: 'kanban-card-move' });
        const idx = this.columns.indexOf(status);
        const prev = this.columns[idx - 1];
        const next = this.columns[idx + 1];

        if (prev) {
            const prevBtn = moveEl.createEl('button', { cls: 'kanban-card-move-btn', text: `← ${columnLabel(prev)}` });
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.moveTask(task, prev);
            });
        } else {
            moveEl.createDiv({ cls: 'kanban-card-move-spacer' });
        }

        if (next) {
            const nextBtn = moveEl.createEl('button', { cls: 'kanban-card-move-btn', text: `${columnLabel(next)} →` });
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.moveTask(task, next);
            });
        } else {
            moveEl.createDiv({ cls: 'kanban-card-move-spacer' });
        }
    }

    private async openTaskSource(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(file, { eState: { line: task.lineNum - 1 } });
            return;
        }
        // Not on this device yet (git-sync lag) - fall back to a read-only
        // fetch from the server, only in API mode. Never a substitute for
        // local editing when the file genuinely doesn't exist.
        if (!this.apiMode()) {
            new Notice(`Could not find ${task.filePath}`);
            return;
        }
        try {
            const note = await fetchNote(obsidianRequest, this.apiConfig(), task.filePath);
            if (!note) {
                new Notice(`Could not find ${task.filePath} locally or on the server.`);
                return;
            }
            new RemoteNoteModal(this.app, note.path, note.content).open();
        } catch (e) {
            new Notice(`Could not open ${task.filePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async moveTask(task: Task, status: KanbanStatus): Promise<void> {
        if (this.apiMode()) return this.moveTaskViaApi(task, status);

        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (!(file instanceof TFile)) {
            new Notice(`Could not find ${task.filePath}`);
            return;
        }
        try {
            await this.app.vault.process(file, (content) => setStatusTagInContent(content, task.lineNum, status, this.columns));
        } catch (e) {
            new Notice(`Failed to update task: ${e instanceof Error ? e.message : String(e)}`);
        }
        await this.refreshTasks();
    }

    private async moveTaskViaApi(task: Task, status: KanbanStatus): Promise<void> {
        const previous = this.tasks;
        this.tasks = this.tasks.map((t) =>
            (t.filePath === task.filePath && t.lineNum === task.lineNum) ? applyKanbanStatus(t, status, this.columns) : t
        );
        this.render(); // optimistic update, mirrors task-front-end's +page.svelte handleSetKanbanStatus
        try {
            await setKanbanStatus(obsidianRequest, this.apiConfig(), task.filePath, task.lineNum, status, this.columns);
        } catch (e) {
            this.tasks = previous;
            this.render();
            new Notice(`Failed to move task: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }
        await this.refreshTasks(); // reconcile with server truth, picks up concurrent edits from other devices
    }

    private async setTaskDueDate(task: Task, dueDate: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (!(file instanceof TFile)) {
            new Notice(`Could not find ${task.filePath}`);
            return;
        }
        try {
            await this.app.vault.process(file, (content) => setDueDateInContent(content, task.lineNum, dueDate || null));
        } catch (e) {
            new Notice(`Failed to update due date: ${e instanceof Error ? e.message : String(e)}`);
        }
        await this.refreshTasks();
    }

    private openAddTaskModal(status: KanbanStatus): void {
        if (this.scannedFiles.length === 0) {
            new Notice('No Markdown files found to add tasks to. Please create a Markdown note first.');
            return;
        }
        new AddTaskModal(this.app, this.scannedFiles, async (title, filePath) => {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!(file instanceof TFile)) {
                new Notice(`Could not find ${filePath}`);
                return;
            }
            try {
                const isDone = status.toLowerCase() === 'done';
                const checkbox = isDone ? 'x' : ' ';
                let tags = `#${status}`;
                if (this.filterTags.length > 0) {
                    tags += ' ' + this.filterTags.map(t => `#${t}`).join(' ');
                }
                const newTaskLine = `\n- [${checkbox}] ${title} ${tags}`;
                await this.app.vault.append(file, newTaskLine);
            } catch (e) {
                new Notice(`Failed to add task: ${e instanceof Error ? e.message : String(e)}`);
            }
            await this.refreshTasks();
        }).open();
    }

    private openAddSubtaskModal(task: Task): void {
        new AddSubtaskModal(this.app, async (subtaskTitle) => {
            const file = this.app.vault.getAbstractFileByPath(task.filePath);
            if (!(file instanceof TFile)) {
                new Notice(`Could not find ${task.filePath}`);
                return;
            }
            try {
                await this.app.vault.process(file, (content) => addSubtaskInContent(content, task.lineNum, subtaskTitle));
            } catch (e) {
                new Notice(`Failed to add subtask: ${e instanceof Error ? e.message : String(e)}`);
            }
            await this.refreshTasks();
        }).open();
    }

    /**
     * Creates a new note for a card and links the task to it - a
     * `[[Note Title]]` inserted into the task line right after its title,
     * matching the `Title   [[Project Note]]` convention already used
     * throughout the vault. Unlike the original plugin, the task line
     * itself (all its tags/fields) is preserved; only the link is added.
     */
    private async createNoteFromCard(task: Task): Promise<void> {
        // Always local, in both modes - the plugin only ever runs inside a
        // real local Obsidian vault, so creating a *new* note always works
        // regardless of serverUrl. "Not on this device" only ever applies to
        // an *existing* file (git-sync lag), never to one being created now.
        const noteTitle = noteTitleFromTask(task.title);
        const file = await this.createAndOpenNote(noteTitle);
        if (!file) return;

        const sourceFile = this.app.vault.getAbstractFileByPath(task.filePath);
        if (sourceFile instanceof TFile) {
            try {
                await this.app.vault.process(sourceFile, (content) =>
                    addNoteLinkToContent(content, task.lineNum, noteTitle));
            } catch (e) {
                new Notice(`Note created, but failed to link the task: ${e instanceof Error ? e.message : String(e)}`);
            }
        } else if (this.apiMode()) {
            // The task's own source file isn't local yet - link it via the
            // server instead. The Tasks PATCH API has no dedicated
            // "insert link into title" action, only whole-title rename, so
            // this is the closest available equivalent to addNoteLinkToContent.
            try {
                await renameTask(obsidianRequest, this.apiConfig(), task.filePath, task.lineNum, `${task.title}   [[${noteTitle}]]`);
            } catch (e) {
                new Notice(`Note created, but failed to link the task on the server: ${e instanceof Error ? e.message : String(e)}`);
            }
        } else {
            new Notice(`Note created, but ${task.filePath} isn't on this device yet - the task wasn't linked.`);
        }

        await this.refreshTasks();
    }

    /**
     * Opens a card's already-linked note, resolving `linkedNote` the same
     * way Obsidian resolves any `[[wikilink]]` (shortest unambiguous path
     * from the task's own file, not just a basename guess). If the link is
     * broken - the note was renamed or deleted - offers to recreate it at
     * that exact name instead of silently failing.
     */
    private async openLinkedNote(task: Task, linkedNote: string): Promise<void> {
        const dest = this.app.metadataCache.getFirstLinkpathDest(linkedNote, task.filePath);
        if (dest) {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(dest);
            return;
        }
        if (this.apiMode()) {
            // GET /api/notes/{path} does the same basename-fallback
            // resolution Obsidian's getFirstLinkpathDest does locally, so
            // check the server before assuming the link is actually broken.
            try {
                const note = await fetchNote(obsidianRequest, this.apiConfig(), linkedNote);
                if (note) {
                    new RemoteNoteModal(this.app, note.path, note.content).open();
                    return;
                }
            } catch (e) {
                new Notice(`Couldn't check the server for "${linkedNote}": ${e instanceof Error ? e.message : String(e)}`);
                return;
            }
        }
        new Notice(`"${linkedNote}" doesn't exist yet - creating it.`);
        await this.createAndOpenNote(linkedNote);
    }

    /**
     * Creates (or, if it already exists, just opens) a note by title in the
     * configured new-note folder/template, and opens it in a new leaf.
     * Content starts empty - the note's filename is already its title in
     * Obsidian's own UI, so a leading "# Title" heading would just be
     * redundant duplication of it.
     */
    private async createAndOpenNote(noteTitle: string): Promise<TFile | null> {
        const folderPath = this.plugin.settings.newNoteFolder.trim().replace(/^\/+|\/+$/g, '');
        const templatePath = this.plugin.settings.newNoteTemplate.trim();

        if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
            try {
                await this.app.vault.createFolder(folderPath);
            } catch (e) {
                new Notice(`Failed to create folder ${folderPath}: ${e instanceof Error ? e.message : String(e)}`);
                return null;
            }
        }

        const fullPath = `${folderPath ? folderPath + '/' : ''}${noteTitle}.md`;
        const existing = this.app.vault.getAbstractFileByPath(fullPath);
        let file: TFile;

        if (existing instanceof TFile) {
            file = existing;
        } else {
            let content = '';
            if (templatePath) {
                const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
                if (templateFile instanceof TFile) {
                    content = await this.app.vault.read(templateFile);
                } else {
                    new Notice(`Note template not found: ${templatePath}, using an empty note`);
                }
            }
            try {
                file = await this.app.vault.create(fullPath, content);
            } catch (e) {
                new Notice(`Failed to create note: ${e instanceof Error ? e.message : String(e)}`);
                return null;
            }
            new Notice(`Created note: ${noteTitle}`);
        }

        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
        return file;
    }
}
