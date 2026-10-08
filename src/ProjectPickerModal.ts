import { App, FuzzySuggestModal } from 'obsidian';

/**
 * Pick the project a task is linked to (type to filter). The first item is
 * "No project", which removes the link; it's the empty string here.
 */
export class ProjectPickerModal extends FuzzySuggestModal<string> {
    constructor(
        app: App,
        private readonly projects: string[],
        private readonly onChoose: (project: string | null) => void
    ) {
        super(app);
        this.setPlaceholder('Link task to project...');
    }

    getItems(): string[] {
        return ['', ...this.projects];
    }

    getItemText(project: string): string {
        return project === '' ? 'No project' : project;
    }

    onChooseItem(project: string): void {
        this.onChoose(project === '' ? null : project);
    }
}
