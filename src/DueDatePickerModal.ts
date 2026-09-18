import { App, Modal, Setting } from 'obsidian';

export class DueDatePickerModal extends Modal {
    dueDate: string = '';
    onSubmit: (dueDate: string) => void | Promise<void>;

    constructor(app: App, initialDate: string, onSubmit: (dueDate: string) => void | Promise<void>) {
        super(app);
        this.dueDate = initialDate;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Set due date')
            .setHeading();

        const dateSetting = new Setting(contentEl)
            .setName('Due date')
            .setDesc('Select a due date for this task.');

        dateSetting.addText(text => {
            text.inputEl.type = 'date';
            text.setValue(this.dueDate);
            text.onChange(value => {
                this.dueDate = value;
            });
            text.inputEl.focus();
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.close();
                    void this.onSubmit(this.dueDate);
                }))
            .addButton(btn => btn
                .setButtonText('Clear date')
                .onClick(() => {
                    this.close();
                    void this.onSubmit('');
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
