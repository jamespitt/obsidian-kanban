import { App, FuzzySuggestModal } from 'obsidian';
import { Task } from './taskModel';

/** Pick the task another task should become a subtask of (type to filter). */
export class ParentPickerModal extends FuzzySuggestModal<Task> {
    constructor(
        app: App,
        private readonly candidates: Task[],
        private readonly onChoose: (parent: Task) => void
    ) {
        super(app);
        this.setPlaceholder('Make this a subtask of...');
    }

    getItems(): Task[] {
        return this.candidates;
    }

    getItemText(task: Task): string {
        // The list name is included so the same title in two lists can be told apart.
        return `${task.title}  (${task.listName})`;
    }

    onChooseItem(task: Task): void {
        this.onChoose(task);
    }
}
