import { App, PluginSettingTab, Setting } from "obsidian";
import KanbanPlugin from "./main";
import { KANBAN_VIEW_TYPE, KanbanView } from "./view";

export interface KanbanSettings {
	// Vault-relative folder to scan for tasks (recursively). Empty string
	// scans the whole vault - matches the "task_folders" behaviour in
	// notesmd-cli's server config, just scoped to one folder here for
	// simplicity.
	taskFolder: string;
	// Where "Create note from card" puts new notes. Empty = vault root.
	newNoteFolder: string;
	// Vault-relative path to a template file used as the new note's starting
	// content. Empty = just "# Title".
	newNoteTemplate: string;
}

export const DEFAULT_SETTINGS: KanbanSettings = {
	taskFolder: '',
	newNoteFolder: '',
	newNoteTemplate: '',
}

export class KanbanSettingTab extends PluginSettingTab {
	plugin: KanbanPlugin;

	constructor(app: App, plugin: KanbanPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Task folder')
			.setDesc('Vault-relative folder to scan for tasks (recursively). Leave blank to scan the whole vault.')
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.taskFolder)
				.onChange(async (value) => {
					this.plugin.settings.taskFolder = value.trim();
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Board columns')
			.setDesc('Default: To Do / In Progress / Done, driven by #ToDo / #InProgress / #Done tags on your tasks - the same convention used by task_viewer.py and the task-front-end web app. A task needs one of a board\'s column tags to appear on it. Each board can define its own columns instead, via its "Edit board" action - see README.md.');

		new Setting(containerEl)
			.setName('New note folder')
			.setDesc('Where notes created from a board card are placed. Leave blank for the vault root.')
			.addText(text => text
				.setPlaceholder('Projects')
				.setValue(this.plugin.settings.newNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.newNoteFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('New note template')
			.setDesc('Vault-relative path to a note used as the starting content for notes created from a card. Leave blank for a plain title-only note.')
			.addText(text => text
				.setPlaceholder('Templates/Project.md')
				.setValue(this.plugin.settings.newNoteTemplate)
				.onChange(async (value) => {
					this.plugin.settings.newNoteTemplate = value.trim();
					await this.plugin.saveSettings();
				}));
	}

	private refreshViews() {
		this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE).forEach(leaf => {
			if (leaf.view instanceof KanbanView) {
				void leaf.view.refresh();
			}
		});
	}
}
