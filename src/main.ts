import { Plugin, WorkspaceLeaf } from 'obsidian';
import { KanbanView, KANBAN_VIEW_TYPE } from './view';
import { DEFAULT_SETTINGS, KanbanSettings, KanbanSettingTab } from './settings';

export default class KanbanPlugin extends Plugin {
    settings: KanbanSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(
            KANBAN_VIEW_TYPE,
            (leaf) => new KanbanView(leaf, this)
        );

        this.addRibbonIcon('layout-grid', 'Open Kanban board', () => {
            void this.activateView();
        });

        this.addCommand({
            id: 'open-view',
            name: 'Open Kanban board',
            callback: () => {
                void this.activateView();
            }
        });

        this.addSettingTab(new KanbanSettingTab(this.app, this));
    }

    onunload() {
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null | undefined = null;
        const leaves = workspace.getLeavesOfType(KANBAN_VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({ type: KANBAN_VIEW_TYPE, active: true });
            }
        }

        if (leaf) {
            void workspace.revealLeaf(leaf);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<KanbanSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
