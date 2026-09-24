import { App, Modal, Setting } from 'obsidian';
import { EditableField, PRIORITIES, joinScheduled, splitScheduled } from './taskModel';

type NonDueField = Exclude<EditableField, 'due'>;

const TITLES: Record<NonDueField, string> = {
    scheduled: 'Scheduled',
    priority: 'Priority',
    repeat: 'Repeat'
};

/**
 * Edits one of a card's fields in place (scheduled / priority / repeat).
 * `onSubmit` gets the new value, or null when the field is cleared.
 */
export class FieldEditModal extends Modal {
    private value: string;
    private date = '';
    private time = '';

    constructor(
        app: App,
        private readonly field: NonDueField,
        initial: string,
        private readonly onSubmit: (value: string | null) => void | Promise<void>
    ) {
        super(app);
        this.value = (initial || '').trim();
        if (field === 'scheduled') {
            ({ date: this.date, time: this.time } = splitScheduled(this.value));
        }
    }

    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setName(`Edit ${TITLES[this.field].toLowerCase()}`).setHeading();

        if (this.field === 'scheduled') {
            new Setting(contentEl)
                .setName('Date')
                .addText((text) => {
                    text.inputEl.type = 'date';
                    text.setValue(this.date);
                    text.onChange((v) => { this.date = v; });
                    text.inputEl.focus();
                });
            new Setting(contentEl)
                .setName('Time')
                .setDesc('Optional.')
                .addText((text) => {
                    text.inputEl.type = 'time';
                    text.setValue(this.time);
                    text.onChange((v) => { this.time = v; });
                });
        } else if (this.field === 'priority') {
            new Setting(contentEl)
                .setName('Priority')
                .addDropdown((dropdown) => {
                    dropdown.addOption('', 'None');
                    for (const p of PRIORITIES) dropdown.addOption(p, p);
                    // Keep an unusual existing value selectable rather than silently dropping it.
                    if (this.value && !(PRIORITIES as readonly string[]).includes(this.value)) dropdown.addOption(this.value, this.value);
                    dropdown.setValue(this.value);
                    dropdown.onChange((v) => { this.value = v; });
                });
        } else {
            new Setting(contentEl)
                .setName('Repeat rule')
                .setDesc('For example: every day, every week, every 2 weeks on monday.')
                .addText((text) => {
                    text.setPlaceholder('Every week');
                    text.setValue(this.value);
                    text.onChange((v) => { this.value = v; });
                    text.inputEl.focus();
                    text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                        if (e.key === 'Enter') this.submit(this.value);
                    });
                });
        }

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('Save').setCta().onClick(() => this.submit(this.current())))
            .addButton((btn) => btn.setButtonText('Clear').onClick(() => this.submit('')))
            .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()));
    }

    private current(): string {
        return this.field === 'scheduled' ? joinScheduled(this.date, this.time) : this.value;
    }

    private submit(value: string): void {
        const trimmed = value.trim();
        this.close();
        void this.onSubmit(trimmed || null);
    }

    onClose() {
        this.contentEl.empty();
    }
}
