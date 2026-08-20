import { Plugin, normalizePath } from 'obsidian';
import { KanbanView, KANBAN_VIEW_TYPE } from './view';
import { DEFAULT_SETTINGS, KanbanSettings, KanbanSettingTab } from './settings';
import { CreateBoardModal } from './CreateBoardModal';
import { serializeBoardFilter } from './taskModel';

export default class KanbanPlugin extends Plugin {
    settings: KanbanSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(
            KANBAN_VIEW_TYPE,
            (leaf) => new KanbanView(leaf, this)
        );

        // A board is a `.kanban` file - opening one always shows the board
        // view instead of raw markdown, same as the original version of
        // this plugin. Its content is only ever a tag filter, though; see
        // taskModel's parseBoardFilter/serializeBoardFilter.
        this.registerExtensions(['kanban'], KANBAN_VIEW_TYPE);

        this.addRibbonIcon('layout-grid', 'New board', () => {
            this.createNewBoard();
        });

        this.addCommand({
            id: 'create-board',
            name: 'Create new board',
            callback: () => {
                this.createNewBoard();
            }
        });

        this.addSettingTab(new KanbanSettingTab(this.app, this));
    }

    onunload() {
    }

    createNewBoard() {
        const { vault, workspace } = this.app;

        new CreateBoardModal(this.app, async (boardName: string, filterTagsRaw: string) => {
            if (!boardName.trim()) boardName = 'Untitled board';
            const filterTags = filterTagsRaw
                .split(',')
                .map((t) => t.trim().replace(/^#/, ''))
                .filter((t) => t.length > 0);

            let fileName = normalizePath(`${boardName}.kanban`);
            let counter = 1;
            while (vault.getAbstractFileByPath(fileName)) {
                fileName = normalizePath(`${boardName} ${counter}.kanban`);
                counter++;
            }

            const file = await vault.create(fileName, serializeBoardFilter(filterTags));
            const leaf = workspace.getLeaf(true);
            await leaf.openFile(file);
        }).open();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<KanbanSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
