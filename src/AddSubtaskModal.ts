import { App, Modal, Setting, Notice } from 'obsidian';

export class AddSubtaskModal extends Modal {
    subtaskTitle: string = '';
    onSubmit: (title: string) => void | Promise<void>;

    constructor(
        app: App,
        onSubmit: (title: string) => void | Promise<void>
    ) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Add subtask')
            .setHeading();

        new Setting(contentEl)
            .setName('Subtask title')
            .addText(text => {
                text.setValue(this.subtaskTitle);
                text.onChange(value => {
                    this.subtaskTitle = value;
                });
                text.inputEl.focus();
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Add')
                .setCta()
                .onClick(() => {
                    if (!this.subtaskTitle.trim()) {
                        new Notice('Please enter a subtask title.');
                        return;
                    }
                    this.close();
                    void this.onSubmit(this.subtaskTitle);
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => {
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
