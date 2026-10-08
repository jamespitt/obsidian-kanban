import { App, Modal, Setting } from 'obsidian';
import { boardProjectOptions } from './taskModel';

/** Edits a board's tag filter, column list and project filter (see taskModel's parseBoardFilter/parseBoardColumns/parseBoardProject/serializeBoardConfig). */
export class EditBoardModal extends Modal {
    filterTags: string;
    columnTags: string;
    project: string;
    onSubmit: (filterTags: string, columnTags: string, project: string) => void;

    constructor(
        app: App,
        currentFilterTags: string,
        currentColumnTags: string,
        private readonly projects: string[],
        currentProject: string,
        onSubmit: (filterTags: string, columnTags: string, project: string) => void
    ) {
        super(app);
        this.filterTags = currentFilterTags;
        this.columnTags = currentColumnTags;
        this.project = currentProject;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('Edit board')
            .setHeading();

        new Setting(contentEl)
            .setName('Filter')
            .setDesc('Comma-separated tags. Only tasks carrying one of these (as well as one of the columns below) will show on this board. Leave blank to show everything in scope.')
            .addText(text => {
                text.setPlaceholder('Home, urgent');
                text.setValue(this.filterTags);
                text.onChange(value => {
                    this.filterTags = value;
                });
                text.inputEl.focus();
            });

        new Setting(contentEl)
            .setName('Project')
            .setDesc('Only show tasks linked to this project, or tasks with no project. Leave it on all projects to show every project.')
            .addDropdown(dropdown => {
                for (const { value, label } of boardProjectOptions(this.projects, this.project)) {
                    dropdown.addOption(value, label);
                }
                dropdown.setValue(this.project);
                dropdown.onChange(value => {
                    this.project = value;
                });
            });

        new Setting(contentEl)
            .setName('Columns')
            .setDesc('Comma-separated tags, left to right - these replace the default `#ToDo`/`#InProgress`/`#Done` columns for this board only. A column literally named "Done" (any case) still completes a task moved onto it; other custom columns just move the tag. Leave blank for the default three - which also keeps this board in sync with task-front-end and task_viewer.py, unlike a custom set.')
            .addText(text => text
                .setPlaceholder('Backlog, review, done')
                .setValue(this.columnTags)
                .onChange(value => {
                    this.columnTags = value;
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onSubmit(this.filterTags, this.columnTags, this.project);
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
