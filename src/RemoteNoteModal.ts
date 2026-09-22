import { App, Modal, Setting } from 'obsidian';

/**
 * Read-only fallback shown when API mode needs to display a note that
 * doesn't exist locally yet on this device (git-sync lag) - fetched live
 * from the server instead. Editing still requires waiting for git sync or
 * switching to task-front-end; this is a viewer, not an editor.
 */
export class RemoteNoteModal extends Modal {
    constructor(app: App, private path: string, private content: string) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName(this.path)
            .setDesc('From the server, read-only')
            .setHeading();

        contentEl.createEl('p', {
            cls: 'kanban-remote-note-notice',
            text: "This note hasn't synced to this device yet - showing the server's copy. Edits here won't be saved."
        });
        contentEl.createEl('pre', { cls: 'kanban-remote-note-content' }).setText(this.content);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
