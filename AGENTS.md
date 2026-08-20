# Obsidian Kanban Plugin

## Purpose

This repository is dedicated to the development of a modern, feature-rich Kanban plugin for Obsidian. The goal is to provide a seamless, markdown-backed Kanban experience that integrates deeply with Obsidian's ecosystem, allowing users to manage tasks and projects directly within their vaults.

## Development Goals

1. **Markdown-Backed**: Ensure all board data is stored in standard Markdown files.
2. **Interactive UI**: Build a responsive and intuitive drag-and-drop interface.
3. **Deep Integration**: Support Obsidian-native features like links, tags, and dataview-style queries.
4. **Customizability**: Allow users to define their own board layouts and styles.

## Project Overview

- **Target**: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- **Entry point**: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- **Required release artifacts**: `main.js`, `manifest.json`, and optional `styles.css`.
- **Primary Technologies**: TypeScript, Obsidian API, esbuild.

## Environment & Tooling

- **Node.js**: current LTS (Node 18+ recommended).
- **Package manager**: npm (required - `package.json` defines scripts and dependencies).
- **Task runner**: [Task](https://taskfile.dev/) (used for common developer commands).
- **Bundler**: esbuild (required - `esbuild.config.mjs` is configured for bundling).
- **Types**: `obsidian` type definitions.

### Commands
- `npm install`: Install dependencies.
- `task build`: Build the plugin (or `npm run build`).
- `task dev`: Build the plugin in development mode with watch functionality (or `npm run dev`).
- `task check`: Run full project check (npm ci, build, lint).
- `task lint`: Run eslint (or `npm run lint`).

## File & Folder Conventions

- **Organize code into multiple files**: Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Current structure** (see README.md for what each does):
  ```
  src/
    main.ts              # Plugin entry point, lifecycle management, registers .kanban as a file type
    settings.ts          # Settings interface and defaults
    taskModel.ts         # Pure parsing/editing logic, no Obsidian API dependency - see tests/taskModel.test.ts
    view.ts              # Kanban board TextFileView (vault scanning, rendering, drag-and-drop, note creation)
    CreateBoardModal.ts  # Modal for naming a new board + its optional filter/columns
    EditBoardModal.ts    # Modal for editing an existing board's filter/columns
  ```
  A board is a `.kanban` file (`registerExtensions` in `main.ts`), like the original version of this plugin - but unlike that version, a board file's content is only ever a tag filter and column list (`parseBoardFilter`/`parseBoardColumns`/`serializeBoardConfig` in `taskModel.ts`), never card data. Cards always come from a live vault scan of real task lines; nothing task-related is ever written into a board file. Columns default to `KANBAN_STATUSES` (To Do/In Progress/Done, matching task-front-end/task_viewer.py) unless a board defines its own; `kanbanStatus`/`filterKanban`/`setStatusTagInContent` all take a `columns` parameter (defaulting to `KANBAN_STATUSES`) rather than hard-coding the three, and `columnLabel` derives a display label for any column tag, custom or default, by splitting camelCase/underscore boundaries.
  `taskModel.ts` is deliberately Obsidian-independent so it can be smoke-tested outside the plugin sandbox (`node_modules/.bin/esbuild tests/taskModel.test.ts --bundle --platform=node --outfile=/tmp/t.js && node /tmp/t.js` - there's no configured test runner, this project uses plain assertion scripts). Keep new pure logic there and vault I/O in `view.ts`, rather than mixing them.
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files.
- **Release artifacts**: Must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Development Strategy & Conventions

1. **Surgical Updates**: Always use the `replace` tool for precise code modifications.
2. **Verification**: Ensure all changes are validated against the Obsidian API standards.
3. **Type Safety**: Maintain strict TypeScript typing (`"strict": true`).
4. **Idempotency**: Write idempotent code paths so reload/unload doesn't leak listeners or intervals. Use `this.register*` helpers for everything that needs cleanup.
5. **UI/UX**: Prefer sentence case. Use **bold** for literal UI labels. Use arrow notation for navigation: **Settings → Community plugins**.
6. **Feature Flags**: Document any new feature flags or major configuration options in `README.md` under the **Configuration & Feature Flags** section.
7. **Pre-commit Verification**: ALWAYS run `task check` (or `npm run lint && npm run build`) before committing or pushing any changes to ensure the project remains in a valid state and follows all architectural and linting rules.

## Manifest & Releases (`manifest.json`)

- **Stable ID**: Never change the `id` after release.
- **Versioning**: Bump `version` using SemVer. Update `versions.json` to map plugin version → minimum app version.
- **Releases**: Create a GitHub release tag matching `version` (no leading `v`). Attach `manifest.json`, `main.js`, and `styles.css` as individual assets.

## Security, Privacy, and Performance

- **Local First**: Default to local/offline operation. No hidden telemetry.
- **Privacy**: Minimize scope; read/write only what's necessary inside the vault.
- **Startup**: Keep startup light. Defer heavy work and use lazy initialization.
- **Resource Management**: Register and clean up all DOM, app, and interval listeners using `register*` helpers.
- **Mobile**: Avoid Node/Electron APIs for mobile compatibility. Set `isDesktopOnly` if necessary.

## Common Tasks & Patterns

### Registering Listeners Safely
```ts
this.registerEvent(this.app.workspace.on("file-open", f => { /* ... */ }));
this.registerDomEvent(window, "resize", () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

### Adding a Command
```ts
this.addCommand({
  id: "open-kanban-board",
  name: "Open Kanban board",
  callback: () => this.openBoard(),
});
```

### Persisting Settings
```ts
async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  await this.saveData(this.settings);
}
```

## Testing & Troubleshooting

- **Manual Testing**: Copy `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/obsidian-kanban/`.
- **Reloading**: Reload Obsidian and enable the plugin in **Settings → Community plugins**.
- **Missing Build**: If `main.js` is missing, run `npm run build`.

## References

- **Obsidian Sample Plugin**: [https://github.com/obsidianmd/obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- **Obsidian Developer Documentation**: [https://docs.obsidian.md/](https://docs.obsidian.md/)
- **API Definitions**: [https://github.com/obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api)
- **Plugin guidelines**: [https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- **Style Guide**: [https://help.obsidian.md/style-guide](https://help.obsidian.md/style-guide)
