import { App, Modal, Setting } from 'obsidian';

/** Edits a board's tag filter (see taskModel's parseBoardFilter/serializeBoardFilter). */
export class EditFilterModal extends Modal {
    filterTags: string;
    onSubmit: (filterTags: string) => void;

    constructor(app: App, currentFilterTags: string, onSubmit: (filterTags: string) => void) {
        super(app);
        this.filterTags = currentFilterTags;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Edit board filter')
            .setHeading();

        new Setting(contentEl)
            .setDesc('Comma-separated tags. Only tasks carrying one of these (as well as a `#ToDo`/`#InProgress`/`#Done` tag) will show on this board. Leave blank to show everything.')
            .addText(text => {
                text.setPlaceholder('Home, urgent');
                text.setValue(this.filterTags);
                text.onChange(value => {
                    this.filterTags = value;
                });
                text.inputEl.focus();
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onSubmit(this.filterTags);
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
