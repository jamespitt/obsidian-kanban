import { App, Modal, Setting, Notice } from 'obsidian';

/** A place a new task can go: a vault file path (local mode) or a server list name (API mode). */
export interface AddTaskTarget {
    value: string;
    label: string;
}

export class AddTaskModal extends Modal {
    taskTitle: string = '';
    selectedTarget: string = '';
    targets: AddTaskTarget[] = [];
    onSubmit: (title: string, target: string) => void | Promise<void>;

    constructor(
        app: App,
        targets: AddTaskTarget[],
        onSubmit: (title: string, target: string) => void | Promise<void>
    ) {
        super(app);
        this.targets = targets;
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
            for (const target of this.targets) {
                dropdown.addOption(target.value, target.label);
            }
            if (this.targets.length > 0 && this.targets[0]) {
                const defaultTarget = this.targets[0].value;
                dropdown.setValue(defaultTarget);
                this.selectedTarget = defaultTarget;
            }
            dropdown.onChange(value => {
                this.selectedTarget = value;
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
                    if (!this.selectedTarget) {
                        new Notice('No target note selected.');
                        return;
                    }
                    this.close();
                    void this.onSubmit(this.taskTitle, this.selectedTarget);
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
