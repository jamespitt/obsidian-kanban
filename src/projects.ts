import { App } from 'obsidian';
import { isProjectNote } from './taskModel';

/**
 * The names of every project in the vault, sorted. A project is a note whose
 * frontmatter tags include `Project`; its name is the note's basename, which
 * is what a `[[Project]]` link in a task title points at. Read from the
 * metadata cache, so it works the same in API mode and local mode.
 */
export function listProjectNames(app: App): string[] {
    const names = new Set<string>();
    for (const file of app.vault.getMarkdownFiles()) {
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        if (isProjectNote(frontmatter)) names.add(file.basename);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}
