# NLSpec: src/task/

## Purpose
Task execution system that discovers user-defined task files from a project's `tasks/` directory and runs them with an injected context. Tasks can run locally via CLI (`veryfront task <name>`) or in the cloud as Jobs/CronJobs.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `TaskContext` | type | Context object passed to a task's `run()` function (env vars, config, optional projectId) |
| `TaskDefinition` | type | Shape of a task module: optional `name`, optional `description`, required `run(ctx)` |
| `isTaskDefinition` | function | Type guard that returns true when a value is an object with a `run` function |
| `deriveTaskId` | function | Converts a file path to a task ID by stripping the tasks directory prefix and file extension |
| `discoverTasks` | function | Scans a project's tasks directory, loads each module, and returns all valid task definitions plus any errors |
| `findTaskById` | function | Discovers all tasks then returns the one matching a given ID, or null |
| `DiscoveredTask` | type | Metadata for a discovered task: id, name, filePath, exportName, definition |
| `TaskDiscoveryOptions` | type | Options for discovery: projectDir, adapter, optional config/tasksDir/debug |
| `TaskDiscoveryResult` | type | Discovery result: array of tasks and array of errors |
| `runTask` | function | Executes a discovered task's `run()` with a constructed TaskContext, returning success/failure with timing |
| `RunTaskOptions` | type | Options for running: task, optional config/projectId/envAllowlist/debug |
| `TaskRunResult` | type | Run result: success boolean, optional result/error, durationMs |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `join` | `@std/path` | Construct absolute task directory path from projectDir + tasksDir |
| `logger` | `#veryfront/utils` | Structured logging for discovery and runner (components: "task-discovery", "task-runner") |
| `RuntimeAdapter` | `#veryfront/platform` | Filesystem abstraction for checking directory existence and reading files |
| `VeryfrontConfig` | `#veryfront/config` | Determines filesystem type (local vs github vs veryfront-api) for path resolution |
| `collectFiles` | `#veryfront/utils/file-discovery.ts` | Recursively collects .ts/.tsx/.js/.jsx files from the tasks directory |
| `loadHandlerModule` | `#veryfront/routing/api/module-loader/loader.ts` | Dynamically imports task modules with proper import map resolution |

## Behaviors

### Behavior 1: Type guard validation
- **Given**: Any value
- **When**: `isTaskDefinition(value)` is called
- **Then**: Returns `true` only if `value` is a non-null object with a `run` property that is a function
- **Edge cases**: Returns `false` for null, undefined, primitives, and objects where `run` is not a function

### Behavior 2: Task ID derivation from file path
- **Given**: A file path and a tasks directory prefix
- **When**: `deriveTaskId(filePath, tasksDir)` is called
- **Then**: Strips the directory prefix (with or without trailing slash) and removes the file extension (.ts, .tsx, .js, .jsx)
- **Edge cases**: If the prefix does not match, the full path (minus extension) is returned. Nested paths produce slash-separated IDs (e.g., "reports/daily").

### Behavior 3: Task discovery scans the tasks directory
- **Given**: A project directory with a `tasks/` subdirectory containing TypeScript/JavaScript files
- **When**: `discoverTasks(options)` is called
- **Then**: Returns a `TaskDiscoveryResult` with all valid task definitions and any per-file errors
- **Edge cases**:
  - If the tasks directory does not exist, returns empty tasks and empty errors
  - If the entire discovery process throws, returns the error associated with the base directory
  - Files matching ignore patterns (node_modules, .git, __tests__, *.test.*, *.spec.*) are skipped
  - Modules that fail to load are recorded in errors, not thrown

### Behavior 4: Export resolution priority
- **Given**: A loaded task module
- **When**: Scanning for a TaskDefinition export
- **Then**: The `default` export is preferred. If the default export is not a valid TaskDefinition, falls back to named exports.
- **Edge cases**: Only the first valid named export per file is used. Modules with no valid exports are silently skipped.

### Behavior 5: Filesystem type determines path strategy
- **Given**: A `VeryfrontConfig` with `fs.type` set
- **When**: Discovery resolves the base directory
- **Then**: For "github" or "veryfront-api" fs types, uses relative paths (just the tasksDir). For "local" (or unset), joins projectDir with tasksDir to form an absolute path.

### Behavior 6: Find task by ID
- **Given**: A task ID and discovery options
- **When**: `findTaskById(taskId, options)` is called
- **Then**: Performs full discovery and returns the matching task, or null if not found

### Behavior 7: Task execution with context
- **Given**: A DiscoveredTask and run options
- **When**: `runTask(options)` is called
- **Then**: Constructs a TaskContext with environment variables, config, and projectId, then calls `task.definition.run(ctx)`. Returns a TaskRunResult with success=true and the return value on success, or success=false and the error message on failure. Always includes durationMs.
- **Edge cases**: Both sync and async `run()` functions are supported. Non-Error thrown values are coerced to strings.

### Behavior 8: Environment variable allowlist filtering
- **Given**: An `envAllowlist` array in RunTaskOptions
- **When**: Building the TaskContext env
- **Then**: Only environment variables whose names appear in the allowlist are included. If no allowlist is provided, all environment variables are passed through.
- **Edge cases**: Allowlist entries that do not exist in the environment are silently ignored.

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/task/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: deno fmt --check src/task/ && deno lint src/task/

## Error Handling
- Per-file load errors during discovery are caught and recorded in the errors array (not thrown)
- Top-level discovery errors (e.g., filesystem failures) are caught, logged, and returned in errors
- Task runtime errors are caught by `runTask`, which returns `{ success: false, error: message, durationMs }`
- Non-Error thrown values are coerced via `String(error)`

## Side Effects
- `discoverTasks` performs filesystem reads (directory existence check, file collection, module loading)
- `runTask` reads `Deno.env.toObject()` to populate the task context
- Both discovery and runner emit log messages via the structured logger (debug-gated for info, always-on for errors)
- Task `run()` functions may perform arbitrary side effects (network, filesystem, etc.)

## Performance Constraints
- `findTaskById` discovers ALL tasks before filtering; a TODO notes this could be optimized to short-circuit
- Discovery loads and evaluates every module in the tasks directory

## Invariants
- Every discovered task has a non-empty `id` derived from its file path
- Every discovered task has a `definition` with a callable `run` function
- `TaskRunResult.durationMs` is always present regardless of success or failure
- At most one task definition is extracted per file
