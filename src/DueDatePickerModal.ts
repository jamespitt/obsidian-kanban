import { App, Modal, Setting, ButtonComponent } from 'obsidian';
import { joinScheduled, splitScheduled } from './taskModel';

export class DueDatePickerModal extends Modal {
    dateVal: string = '';
    timeVal: string = '';
    onSubmit: (dueDate: string) => void | Promise<void>;

    constructor(app: App, initialDue: string, onSubmit: (dueDate: string) => void | Promise<void>) {
        super(app);
        this.onSubmit = onSubmit;
        
        // Accepts `2026-03-27T09:30` (what every client writes) and the
        // older space-separated `2026-03-27 09:30`.
        ({ date: this.dateVal, time: this.timeVal } = splitScheduled(initialDue));
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Set due date')
            .setHeading();

        const dateSetting = new Setting(contentEl)
            .setName('Due date')
            .setDesc('Select a due date for this task.');

        let dateInputEl: HTMLInputElement;

        dateSetting.addText(text => {
            text.inputEl.type = 'date';
            text.setValue(this.dateVal);
            text.onChange(value => {
                this.dateVal = value;
            });
            dateInputEl = text.inputEl;
            text.inputEl.focus();
        });

        // Add easy preset buttons container
        const presetsContainer = contentEl.createDiv({ cls: 'due-date-presets' });

        const formatDate = (date: Date): string => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const createPresetBtn = (label: string, getDate: () => Date) => {
            new ButtonComponent(presetsContainer)
                .setButtonText(label)
                .onClick((e) => {
                    const d = formatDate(getDate());
                    this.dateVal = d;
                    if (dateInputEl) {
                        dateInputEl.value = d;
                    }
                });
        };

        createPresetBtn('Today', () => new Date());
        createPresetBtn('Tomorrow', () => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return d;
        });
        createPresetBtn('In 3 days', () => {
            const d = new Date();
            d.setDate(d.getDate() + 3);
            return d;
        });
        createPresetBtn('In 1 week', () => {
            const d = new Date();
            d.setDate(d.getDate() + 7);
            return d;
        });

        const timeSetting = new Setting(contentEl)
            .setName('Due time (optional)')
            .setDesc('Select a due time for this task.');

        timeSetting.addText(text => {
            text.inputEl.type = 'time';
            text.setValue(this.timeVal);
            text.onChange(value => {
                this.timeVal = value;
            });
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.close();
                    // ISO 8601 (`2026-03-27T09:30`), local time - the same
                    // format as [scheduled::] and as task-front-end/Android.
                    void this.onSubmit(joinScheduled(this.dateVal.trim(), this.timeVal.trim()));
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
