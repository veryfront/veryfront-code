# cli/app Module -- Behavioral NLSpec

## Purpose

Interactive TUI shell for the Veryfront CLI. Provides a dashboard-based terminal
UI for managing local and remote projects, with keyboard navigation, project
creation wizards, authentication, and console log display.

## Public API (cli/app/index.ts)

| Export                | Kind          | Description                                      |
|-----------------------|---------------|--------------------------------------------------|
| `createApp`           | function      | Factory returning an `App` handle (from shell.ts) |
| `showStartup`        | function      | Plays startup animation with step checklist       |
| `App`                 | type          | Handle: start, stop, update, render, log, etc.   |
| `AppConfig`           | type          | Config: port, projects map, headless flag, etc.   |
| `AppState`            | type          | Full UI state tree                                |
| `LogMeta`             | type          | Structured metadata for HTTP request logs         |
| `ProjectInfo`         | type          | Slug + path + type for a project                  |
| `StateUpdater`        | type          | `(state: AppState) => AppState`                   |
| `*` from state.ts     | re-export     | All state updater functions                       |
| `*` from actions.ts   | re-export     | IDE/browser/Studio open actions                   |
| `*` from list-select  | re-export     | List component state + rendering                  |

Only consumer: `cli/commands/start/command.ts` (dynamic import of `createApp` and `showStartup`).

## Submodules

### state.ts -- Immutable state tree + updater functions

- **AppState**: view, server status, MCP status, remote auth, project/example/template lists, wizard, input, logs.
- **Updaters** (all return `StateUpdater`): `setProjects`, `setExamples`, `setTemplates`, `updateServer`, `updateMCP`, `updateRemote`, `navigateTo`, `goBack`, `setActiveList`, `updateActiveList`, `selectProject`, `updateWizard`, `resetWizard`, `startInput`, `updateInputValue`, `endInput`, `addLog`, `clearLogs`, `toggleLogsExpanded`, `toggleHelp`, `scrollLogs`.
- **Query**: `getActiveSelection` returns selected `ListItem<ProjectInfo>` from the active list.
- `shortenPath` (private): displays paths relative to cwd or ~ for home.

### shell.ts -- Main app orchestrator

- `createApp(config)` returns an `App` object managing:
  - **Initialization**: sets projects, templates, server/MCP state; checks auth in background.
  - **Rendering**: switch/case on `state.view` to compose content + logs + input.
  - **Input loop**: raw-mode stdin reader with escape-sequence buffering.
  - **Key handling**: global keys (quit, escape, logs toggle), view-specific delegation, dashboard navigation (list up/down, tab sections, number/letter shortcuts), action keys (open browser/studio/IDE, new project, pull/push, auth, MCP settings).
  - **Headless mode**: skips TUI, prints server URL to stdout.

### actions.ts -- Side-effect actions

- `openInBrowser(project, port)`: opens `http://{slug}.veryfront.me:{port}`.
- `openInStudio(project)`: opens `https://veryfront.com/projects/{slug}`.
- `detectIDEs()` / `getPreferredIDE()`: probes for cursor, code, zed, idea, webstorm via `which`.
- `openInIDE(project, ide?)` / `openFileInIDE(path, ide?)`: opens path in detected IDE.
- `openMCPSettings()`: ensures `~/.claude/settings.json` exists, opens in IDE.

### types.ts -- Core interfaces

- `AppConfig`: port, projects, examples, defaultProject, mcpPort, headless.
- `App`: start, stop, update, getState, render, setServerReady, addError, clearErrors, log, interceptConsole.

### startup.ts -- Startup animation driver

- `showStartup(steps)`: renders spinning avatar + step checklist in alt screen, then holds.

### utils.ts -- Utility functions

- `copyDirectory(src, dest)`: recursive file copy via platform FS.
- `generateRandomSlug()`: random `{adjective}-{noun}` from word lists.
- `normalizeSlug(name)`: lowercases and replaces non-alphanumeric with hyphens.
- `getLocalProjectsFromState(state)`: extracts `{slug, path}[]` from state.
- `pullRemoteProject(state, update, render, slug)`: authenticates then pulls a remote project.

### views/ -- View renderers (pure string output)

| File          | Exports                                          |
|---------------|--------------------------------------------------|
| dashboard.ts  | `renderDashboard`, `renderEmptyState`, `renderDashboardBoxed` |
| startup.ts    | `renderStartup`, `createStartupState`, `incrementFrame`, `setStepActive`, `setStartupReady` |
| templates.ts  | `renderTemplatesView`                            |
| new-project.ts| `renderNewProjectView`                           |
| auth.ts       | `renderAuthView`                                 |
| help.ts       | `renderHelpView`                                 |
| examples.ts   | `renderExamplesView`                             |

### handlers/ -- Keyboard input handlers

| File                  | Exports                                                  |
|-----------------------|----------------------------------------------------------|
| remote-navigation.ts  | `updateRemoteFocus`, `moveRemoteFocusUp`, `moveRemoteFocusDown` |
| view-handlers.ts      | `handleTemplatesKey`, `handleNewProjectKey`, `handleAuthKey`, `ViewHandlerContext` |

### operations/ -- Business logic

| File                  | Exports                                                              |
|-----------------------|----------------------------------------------------------------------|
| project-creation.ts   | `createProject`, `createProjectFromExample`, `promptForProjectName`, `promptForExampleProject`, `ProjectCreationContext` |

### components/ -- Reusable TUI components

| File            | Exports                                                              |
|-----------------|----------------------------------------------------------------------|
| list-select.ts  | `ListItem`, `ListSelectState`, `ListSelectOptions`, `createListState`, `moveUp`, `moveDown`, `selectByNumber`, `getSelectedItem`, `renderList`, `listSection` |
| inline-input.ts | `renderInput`, `renderLogs`, `handleInputKey`, `InlineInputOptions`, `RenderLogsOptions` |

### logging/ -- Console interception

| File                    | Exports                                                  |
|-------------------------|----------------------------------------------------------|
| console-interceptor.ts  | `parseRequestLog`, `createCapture`, `interceptConsole`, `InterceptOptions` |

### data/ -- Static data

| File           | Exports                     |
|----------------|-----------------------------|
| slug-words.ts  | `ADJECTIVES`, `NOUNS` arrays |

## Key Behaviors

1. **View routing**: `state.view` drives which renderer is called; `navigateTo`/`goBack` manage a single-level history stack.
2. **List navigation**: Generic `ListSelectState<T>` with up/down/wrap-around, scroll offsets, number shortcuts.
3. **Input mode**: When `state.input.active`, all keys route to `handleInputKey`; submit/cancel callbacks restore normal mode.
4. **Logs area**: Appended via `addLog`, capped at `maxLogs`; expandable with scroll.
5. **Auth flow**: Provider selection -> `login()` -> fetch remote projects -> update state.
6. **Project creation**: Template or scratch -> prompt name -> `reserveProjectSlug` -> `initCommand` -> update lists.
7. **Console interception**: Replaces `console.*` methods to route output into TUI log display.
8. **Headless mode**: Non-interactive fallback that prints URLs to stdout; no TUI, no key handling.

## Test Coverage

- `state.test.ts`: All state updater functions, initial state shape, `getActiveSelection`.
- `actions.test.ts`: Export existence checks, type shape validation.
- `data/slug-words.test.ts`: Array non-empty, lowercase, no duplicates, expected values present.
