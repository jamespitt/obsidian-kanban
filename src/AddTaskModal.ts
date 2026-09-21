import { App, Modal, Setting, TFile, Notice } from 'obsidian';

export class AddTaskModal extends Modal {
    taskTitle: string = '';
    selectedFilePath: string = '';
    scannedFiles: TFile[] = [];
    onSubmit: (title: string, filePath: string) => void | Promise<void>;

    constructor(
        app: App,
        scannedFiles: TFile[],
        onSubmit: (title: string, filePath: string) => void | Promise<void>
    ) {
        super(app);
        this.scannedFiles = scannedFiles;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Add new task')
            .setHeading();

        new Setting(contentEl)
            .setName('Task title')
            .addText(text => {
                text.setValue(this.taskTitle);
                text.onChange(value => {
                    this.taskTitle = value;
                });
                text.inputEl.focus();
            });

        const fileSetting = new Setting(contentEl)
            .setName('Target note')
            .setDesc('Select the note to add this task to.');

        fileSetting.addDropdown(dropdown => {
            for (const file of this.scannedFiles) {
                dropdown.addOption(file.path, file.basename);
            }
            if (this.scannedFiles.length > 0 && this.scannedFiles[0]) {
                const defaultPath = this.scannedFiles[0].path;
                dropdown.setValue(defaultPath);
                this.selectedFilePath = defaultPath;
            }
            dropdown.onChange(value => {
                this.selectedFilePath = value;
            });
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Add')
                .setCta()
                .onClick(() => {
                    if (!this.taskTitle.trim()) {
                        new Notice('Please enter a task title.');
                        return;
                    }
                    if (!this.selectedFilePath) {
                        new Notice('No target note selected.');
                        return;
                    }
                    this.close();
                    void this.onSubmit(this.taskTitle, this.selectedFilePath);
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
