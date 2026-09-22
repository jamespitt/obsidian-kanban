import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import KanbanPlugin from "./main";
import { KANBAN_VIEW_TYPE, KanbanView } from "./view";
import { KANBAN_STATUSES } from "./taskModel";
import { ApiConfig, fetchKanbanTasks, fetchVaults } from "./apiClient";
import { obsidianRequest } from "./obsidianRequest";

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
	// notesmd-cli serve base URL, e.g. "https://tasks.example.com". Empty
	// (the default) means every board stays in local vault-file mode,
	// exactly as before. Non-empty switches a board's card listing and
	// card-move writes to this HTTP API - see apiClient.ts/view.ts.
	serverUrl: string;
	// HTTP Basic Auth, sent on every API-mode request.
	username: string;
	password: string;
	// Which of the server's configured vaults to talk to. Empty = the
	// server's own default vault.
	vaultId: string;
}

export const DEFAULT_SETTINGS: KanbanSettings = {
	taskFolder: '',
	newNoteFolder: '',
	newNoteTemplate: '',
	serverUrl: '',
	username: '',
	password: '',
	vaultId: '',
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

		new Setting(containerEl)
			.setName('Server (HTTP API mode)')
			.setDesc("Optional. When server URL is set, every board's card list and card moves go through the task server's HTTP API instead of scanning local vault files - for devices where the server is reachable. Leave server URL blank to keep boards fully local (the default).")
			.setHeading();

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('e.g. https://tasks.example.com. Leave blank for local vault-file mode.')
			.addText(text => text
				.setPlaceholder('https://tasks.example.com')
				.setValue(this.plugin.settings.serverUrl)
				.onChange(async (value) => {
					this.plugin.settings.serverUrl = value.trim().replace(/\/+$/, '');
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('HTTP basic auth username, if the server requires one.')
			.addText(text => text
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('HTTP basic auth password.')
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
						this.refreshViews();
					});
			});

		new Setting(containerEl)
			.setName('Vault')
			.setDesc("Which of the server's configured vaults to use. Leave blank for the server's default. Use load vaults below to see the available ids.")
			.addText(text => text
				.setPlaceholder('Default')
				.setValue(this.plugin.settings.vaultId)
				.onChange(async (value) => {
					this.plugin.settings.vaultId = value.trim();
					await this.plugin.saveSettings();
					this.refreshViews();
				}));

		new Setting(containerEl)
			.setName('Load vaults')
			.setDesc("List the vaults this server offers, so you can copy the right ID into the vault field above.")
			.addButton(btn => btn
				.setButtonText('Load vaults')
				.onClick(async () => {
					try {
						const vaults = await fetchVaults(obsidianRequest, this.apiConfig());
						if (vaults.length === 0) {
							new Notice('No vaults configured on this server (or it predates vault switching).');
						} else {
							new Notice(`Vaults: ${vaults.map(v => `${v.id} (${v.label})`).join(', ')}`, 10000);
						}
					} catch (e) {
						new Notice(`Failed to load vaults: ${e instanceof Error ? e.message : String(e)}`);
					}
				}));

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Checks the server URL, credentials, and vault ID together.')
			.addButton(btn => btn
				.setButtonText('Test connection')
				.onClick(async () => {
					if (!this.plugin.settings.serverUrl) {
						new Notice('Set a server URL first.');
						return;
					}
					try {
						const tasks = await fetchKanbanTasks(obsidianRequest, this.apiConfig(), [...KANBAN_STATUSES]);
						new Notice(`Connected - found ${tasks.length} kanban task(s).`);
					} catch (e) {
						new Notice(`Connection failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}));
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

	private refreshViews() {
		this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE).forEach(leaf => {
			if (leaf.view instanceof KanbanView) {
				void leaf.view.refresh();
			}
		});
	}
}
