import { App, Modal, Setting } from 'obsidian';

export class CreateBoardModal extends Modal {
    boardName: string = '';
    filterTags: string = '';
    onSubmit: (boardName: string, filterTags: string) => void | Promise<void>;

    constructor(app: App, onSubmit: (boardName: string, filterTags: string) => void | Promise<void>) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Create new board')
            .setHeading();

        new Setting(contentEl)
            .setName('Board name')
            .addText(text => {
                text.setValue(this.boardName);
                text.onChange(value => {
                    this.boardName = value;
                });
                text.inputEl.focus();
            });

        new Setting(contentEl)
            .setName('Filter (optional)')
            .setDesc('Comma-separated tags. Only tasks carrying one of these (as well as a `#ToDo`/`#InProgress`/`#Done` tag) will show on this board. Leave blank to show everything.')
            .addText(text => text
                .setPlaceholder('Home, urgent')
                .setValue(this.filterTags)
                .onChange(value => {
                    this.filterTags = value;
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.close();
                    void this.onSubmit(this.boardName, this.filterTags);
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
