import { TextFileView, WorkspaceLeaf, TFile, Notice, Menu, debounce, Debouncer } from 'obsidian';
import KanbanPlugin from './main';
import { EditFilterModal } from './EditFilterModal';
import {
    Task,
    KanbanStatus,
    KANBAN_STATUSES,
    parseTaskLine,
    kanbanStatus,
    filterKanban,
    matchesFilter,
    setStatusTagInContent,
    parseBoardFilter,
    serializeBoardFilter,
    noteTitleFromTask,
    addNoteLinkToContent
} from './taskModel';

export const KANBAN_VIEW_TYPE = 'kanban-board-view';

const COLUMN_LABELS: Record<KanbanStatus, string> = {
    ToDo: 'To Do',
    InProgress: 'In Progress',
    Done: 'Done'
};

/**
 * A board over the vault's real tasks, driven by the #ToDo/#InProgress/#Done
 * tags - the same convention task_viewer.py (TUI) and task-front-end (web)
 * use. A board is a `.kanban` file, like the original version of this
 * plugin, but its content is only ever a tag filter (see taskModel's
 * parseBoardFilter/serializeBoardFilter) - never task data. Tasks always
 * live in, and are edited in place in, their real source files; a board is
 * just a saved, reopenable view over a subset of them.
 */
export class KanbanView extends TextFileView {
    plugin: KanbanPlugin;
    private tasks: Task[] = [];
    private filterTags: string[] = [];
    private draggedTask: Task | null = null;
    private scheduleRefresh: Debouncer<[], void>;

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
        return serializeBoardFilter(this.filterTags);
    }

    setViewData(data: string, _clear: boolean): void {
        this.filterTags = parseBoardFilter(data);
        void this.refreshTasks();
    }

    clear(): void {
        this.tasks = [];
        this.filterTags = [];
    }

    async onOpen(): Promise<void> {
        this.registerEvent(this.app.vault.on('modify', (f) => {
            if (f instanceof TFile && f.path === this.file?.path) return;
            this.scheduleRefresh();
        }));
        this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
        this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
        this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));

        this.addAction('refresh-cw', 'Refresh', () => { void this.refreshTasks(); });
        this.addAction('filter', 'Edit filter', () => this.editFilter());
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

    private async scanTasks(): Promise<Task[]> {
        const folder = this.plugin.settings.taskFolder.trim().replace(/^\/+|\/+$/g, '');
        const files = this.app.vault.getMarkdownFiles().filter((f) => {
            if (!folder) return true;
            return f.path === `${folder}.md` || f.path.startsWith(`${folder}/`);
        });

        const tasks: Task[] = [];
        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line === undefined) continue;
                const task = parseTaskLine(line, file.path, i + 1);
                if (task) tasks.push(task);
            }
        }
        return tasks;
    }

    private editFilter(): void {
        new EditFilterModal(this.app, this.filterTags.join(', '), (input) => {
            this.filterTags = input.split(',').map((t) => t.trim().replace(/^#/, '')).filter((t) => t.length > 0);
            this.requestSave();
            this.render();
        }).open();
    }

    private render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass('kanban-board-container');

        const board = filterKanban(this.tasks).filter((t) => matchesFilter(t, this.filterTags));
        const columns: Record<KanbanStatus, Task[]> = { ToDo: [], InProgress: [], Done: [] };
        for (const task of board) {
            const status = kanbanStatus(task);
            if (status) columns[status].push(task);
        }

        if (this.filterTags.length > 0) {
            const filterEl = container.createDiv({ cls: 'kanban-board-filter' });
            filterEl.setText(`Filtered to: ${this.filterTags.map((t) => `#${t}`).join(', ')}`);
        }

        const boardEl = container.createDiv({ cls: 'kanban-columns' });

        for (const status of KANBAN_STATUSES) {
            const colEl = boardEl.createDiv({ cls: 'kanban-column' });

            const headerEl = colEl.createDiv({ cls: 'kanban-column-header' });
            headerEl.createSpan({ cls: 'kanban-column-title', text: COLUMN_LABELS[status] });
            headerEl.createSpan({ cls: 'kanban-column-count', text: String(columns[status].length) });

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

            if (columns[status].length === 0) {
                bodyEl.createDiv({ cls: 'kanban-empty', text: 'No tasks' });
            }

            for (const task of columns[status]) {
                this.renderCard(bodyEl, task, status);
            }
        }
    }

    private renderCard(parent: HTMLElement, task: Task, status: KanbanStatus): void {
        const cardEl = parent.createDiv({ cls: 'kanban-card' });
        if (task.status === 'completed') cardEl.addClass('kanban-card--completed');
        cardEl.setAttr('draggable', 'true');

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
        cardEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const menu = new Menu();
            menu.addItem((item) => {
                item.setTitle('Create note from card')
                    .setIcon('file-plus')
                    .onClick(() => { void this.createNoteFromCard(task); });
            });
            menu.addItem((item) => {
                item.setTitle('Open source')
                    .setIcon('file-text')
                    .onClick(() => { void this.openTaskSource(task); });
            });
            menu.showAtMouseEvent(e);
        });

        cardEl.createDiv({ cls: 'kanban-card-title', text: task.title });

        const otherTags = task.tags.filter((t) => t.toLowerCase() !== status.toLowerCase());
        if (task.listName || task.due || task.priority || otherTags.length > 0) {
            const metaEl = cardEl.createDiv({ cls: 'kanban-card-meta' });
            if (task.listName) metaEl.createSpan({ cls: 'kanban-card-list', text: task.listName });
            if (task.due) metaEl.createSpan({ cls: 'kanban-card-due', text: `\u{1F4C5} ${task.due.slice(0, 10)}` });
            if (task.priority) metaEl.createSpan({ cls: 'kanban-card-priority', text: `↑ ${task.priority}` });
            for (const tag of otherTags) {
                metaEl.createSpan({ cls: 'kanban-card-tag', text: `#${tag}` });
            }
        }

        const moveEl = cardEl.createDiv({ cls: 'kanban-card-move' });
        const idx = KANBAN_STATUSES.indexOf(status);
        const prev = KANBAN_STATUSES[idx - 1];
        const next = KANBAN_STATUSES[idx + 1];

        if (prev) {
            const prevBtn = moveEl.createEl('button', { cls: 'kanban-card-move-btn', text: `← ${COLUMN_LABELS[prev]}` });
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.moveTask(task, prev);
            });
        } else {
            moveEl.createDiv({ cls: 'kanban-card-move-spacer' });
        }

        if (next) {
            const nextBtn = moveEl.createEl('button', { cls: 'kanban-card-move-btn', text: `${COLUMN_LABELS[next]} →` });
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
        if (!(file instanceof TFile)) {
            new Notice(`Could not find ${task.filePath}`);
            return;
        }
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file, { eState: { line: task.lineNum - 1 } });
    }

    private async moveTask(task: Task, status: KanbanStatus): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (!(file instanceof TFile)) {
            new Notice(`Could not find ${task.filePath}`);
            return;
        }
        try {
            await this.app.vault.process(file, (content) => setStatusTagInContent(content, task.lineNum, status));
        } catch (e) {
            new Notice(`Failed to update task: ${e instanceof Error ? e.message : String(e)}`);
        }
        await this.refreshTasks();
    }

    /**
     * Creates a new note for a card and links the task to it - a
     * `[[Note Title]]` inserted into the task line right after its title,
     * matching the `Title   [[Project Note]]` convention already used
     * throughout the vault. Unlike the original plugin, the task line
     * itself (all its tags/fields) is preserved; only the link is added.
     */
    private async createNoteFromCard(task: Task): Promise<void> {
        const noteTitle = noteTitleFromTask(task.title);
        const folderPath = this.plugin.settings.newNoteFolder.trim().replace(/^\/+|\/+$/g, '');
        const templatePath = this.plugin.settings.newNoteTemplate.trim();

        if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
            try {
                await this.app.vault.createFolder(folderPath);
            } catch (e) {
                new Notice(`Failed to create folder ${folderPath}: ${e instanceof Error ? e.message : String(e)}`);
                return;
            }
        }

        const fullPath = `${folderPath ? folderPath + '/' : ''}${noteTitle}.md`;
        const existing = this.app.vault.getAbstractFileByPath(fullPath);
        let file: TFile;

        if (existing instanceof TFile) {
            new Notice(`Note already exists: ${noteTitle}`);
            file = existing;
        } else {
            let content = `# ${noteTitle}\n\n`;
            if (templatePath) {
                const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
                if (templateFile instanceof TFile) {
                    content = await this.app.vault.read(templateFile);
                } else {
                    new Notice(`Note template not found: ${templatePath}, using default content`);
                }
            }
            try {
                file = await this.app.vault.create(fullPath, content);
            } catch (e) {
                new Notice(`Failed to create note: ${e instanceof Error ? e.message : String(e)}`);
                return;
            }
            new Notice(`Created note: ${noteTitle}`);
        }

        const sourceFile = this.app.vault.getAbstractFileByPath(task.filePath);
        if (sourceFile instanceof TFile) {
            try {
                await this.app.vault.process(sourceFile, (content) =>
                    addNoteLinkToContent(content, task.lineNum, noteTitle));
            } catch (e) {
                new Notice(`Note created, but failed to link the task: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        await this.refreshTasks();
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
    }
}
