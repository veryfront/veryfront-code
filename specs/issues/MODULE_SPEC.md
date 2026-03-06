# NLSpec: src/issues/

## Purpose
File-based issue tracking system that stores issues as markdown files with YAML frontmatter. Provides CRUD operations, filtering/sorting, validation schemas, and MCP tool bindings for AI agent integration.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `IssuesManager` | class | Manages issue CRUD operations against a project directory |
| `createIssuesManager` | function | Factory that creates an `IssuesManager` for a given project directory |
| `ISSUES_DIR` | constant | Default subdirectory name for issues (`"issues"`) |
| `parseFrontmatter` | function | Extracts YAML frontmatter and body from markdown content |
| `parseYaml` | function | Parses a limited YAML subset (scalars, arrays, booleans, null) into a record |
| `serializeYaml` | function | Converts `IssueMetadata` into YAML string |
| `serializeIssue` | function | Converts an `Issue` into full markdown-with-frontmatter string |
| `parseIssue` | function | Parses markdown content + path into a validated `Issue`, or null |
| `issuesMcpTools` | constant | Array of MCP tool definitions for AI agent consumption |
| `createIssueSchema` | Zod schema | Validates input for creating an issue |
| `updateIssueSchema` | Zod schema | Validates input for updating an issue |
| `listIssuesSchema` | Zod schema | Validates input for listing/filtering issues |
| `issueMetadataSchema` | Zod schema | Validates full issue metadata structure |
| `issueStateSchema` | Zod schema | Validates issue state (`"open"` or `"closed"`) |
| `issueIdSchema` | Zod schema | Validates issue ID format (e.g., `ISSUE-001`) |
| `ISSUE_ID_PATTERN` | RegExp | Pattern matching valid issue IDs: `PREFIX-NNN+` |
| `ISSUE_PREFIXES` | constant | Allowed prefixes: `["ISSUE", "TASK", "PLAN"]` |
| `generateIssueId` | function | Generates next sequential ID for a given prefix |
| `isValidIssueId` | function | Tests whether a string matches the issue ID pattern |
| `parseIssueId` | function | Extracts prefix and number from an issue ID string |
| `parseState` | function | Resolves state aliases (e.g., "done" -> "closed") to canonical state |
| `validateMetadata` | function | Parses and validates raw data into `IssueMetadata` via Zod |
| `Issue` | type | Full issue: metadata + body + path |
| `IssueMetadata` | type | Frontmatter fields: id, title, state, labels, milestone, assignees, timestamps |
| `IssueState` | type | `"open" | "closed"` |
| `IssuePrefix` | type | `"ISSUE" | "TASK" | "PLAN"` |
| `CreateIssueOptions` | type | Input for creating an issue |
| `UpdateIssueOptions` | type | Input for updating an issue |
| `ListIssuesOptions` | type | Filtering/sorting/pagination options |
| `ListIssuesResult` | type | Result containing issues array and total count |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `join` | `#veryfront/compat/path` | Construct file paths cross-platform |
| `createFileSystem`, `FileSystem` | `#veryfront/platform/compat/fs.ts` | Filesystem abstraction for reading/writing issue files |
| `z` (Zod) | `zod` | Schema validation for all inputs and metadata |
| `cwd` | `#veryfront/platform/compat/process.ts` | Default project directory in MCP tools |
| `MCPTool` | `#veryfront/mcp/types.ts` | Type interface for MCP tool registration |

## Behaviors

### Behavior 1: Create issue
- **Given**: A project directory and a title (plus optional body, labels, milestone, assignees, prefix)
- **When**: `manager.create(options)` is called
- **Then**: A new markdown file is written to `{projectDir}/issues/{PREFIX}-{NNN}.md` with YAML frontmatter. The issue is returned with state `"open"`, auto-generated ID, and current timestamps.
- **Edge cases**:
  - Issues directory is created automatically if it does not exist
  - ID auto-increments based on existing files with the same prefix
  - Default prefix is `"ISSUE"` when not specified
  - IDs are zero-padded to 3 digits (e.g., `001`), but grow beyond 3 when needed (`1000`)
  - Gaps in existing numbering are ignored; next ID is always `max + 1`

### Behavior 2: Get issue by ID
- **Given**: An issue ID string (e.g., `"ISSUE-001"`)
- **When**: `manager.get(id)` is called
- **Then**: The corresponding markdown file is read, parsed, and returned as an `Issue`
- **Edge cases**:
  - Returns `null` if the file does not exist
  - Returns `null` if the file content fails frontmatter parsing or metadata validation

### Behavior 3: Update issue
- **Given**: An issue ID and partial update fields
- **When**: `manager.update(id, options)` is called
- **Then**: The existing issue is read, fields are merged (provided fields override, omitted fields are preserved), `updated_at` is set to current time, and the file is rewritten
- **Edge cases**:
  - Returns `null` if the issue does not exist
  - Setting `milestone` to `null` clears it
  - Omitting a field preserves its current value

### Behavior 4: Delete issue
- **Given**: An issue ID
- **When**: `manager.delete(id)` is called
- **Then**: The markdown file is removed from disk
- **Edge cases**:
  - Returns `true` on success, `false` if the file does not exist

### Behavior 5: List issues with filtering and sorting
- **Given**: Optional filter/sort/limit options
- **When**: `manager.list(options)` is called
- **Then**: All issue files are read, filtered by state/labels/milestone/assignee/prefix, sorted, and returned with a total count
- **Edge cases**:
  - Label filtering requires ALL specified labels to be present (AND logic)
  - Default sort is `created_at` descending
  - `limit` restricts returned issues but `total` reflects the full filtered count
  - Malformed issue files are silently skipped
  - Empty directory returns `{ issues: [], total: 0 }`

### Behavior 6: Close / Reopen issue
- **Given**: An issue ID
- **When**: `manager.close(id)` or `manager.reopen(id)` is called
- **Then**: The issue's state is updated to `"closed"` or `"open"` respectively (delegates to `update`)

### Behavior 7: Add / Remove labels
- **Given**: An issue ID and an array of labels
- **When**: `manager.addLabels(id, labels)` or `manager.removeLabels(id, labels)` is called
- **Then**: Labels are merged (deduplicated via Set) or filtered out, then persisted via `update`
- **Edge cases**:
  - Adding a label that already exists results in no duplicate
  - Removing a label that does not exist is a no-op
  - Returns `null` if the issue does not exist

### Behavior 8: Parse YAML frontmatter
- **Given**: A string with `---` delimited frontmatter
- **When**: `parseFrontmatter(content)` is called
- **Then**: Returns `{ frontmatter, body }` with body trimmed
- **Edge cases**:
  - Returns `null` if no valid `---` delimiters are found
  - Returns `null` if frontmatter section is empty

### Behavior 9: YAML parsing (limited subset)
- **Given**: A YAML string
- **When**: `parseYaml(yaml)` is called
- **Then**: Parses scalar key-value pairs, inline arrays (`[a, b]`), block arrays (`- item`), booleans (`true`/`false`), and null values (`null`/`~`)
- **Edge cases**:
  - Empty arrays (`[]`) produce an empty array
  - Quoted values have quotes stripped
  - Comment lines (starting with `#`) and blank lines are skipped

### Behavior 10: YAML serialization
- **Given**: An `IssueMetadata` object
- **When**: `serializeYaml(metadata)` is called
- **Then**: Produces a YAML string with all metadata fields. Titles are double-quoted with escaped internal quotes. Arrays use inline `[...]` format. Milestone is omitted when undefined.

### Behavior 11: State alias resolution
- **Given**: A string representing a state
- **When**: `parseState(value)` is called
- **Then**: Returns canonical `"open"` or `"closed"` for known aliases (case-insensitive, whitespace-trimmed), or `null` for unknown values
- **Aliases**: open/opened/active -> `"open"`; closed/close/done/resolved/completed -> `"closed"`

### Behavior 12: Issue ID generation
- **Given**: A prefix and list of existing IDs
- **When**: `generateIssueId(prefix, existingIds)` is called
- **Then**: Returns the next sequential ID for that prefix, zero-padded to at least 3 digits
- **Edge cases**:
  - First ID is `PREFIX-001`
  - Only IDs matching the given prefix are considered
  - Gaps in numbering are skipped (uses max, not count)

### Behavior 13: MCP tool exposure
- **Given**: The `issuesMcpTools` array
- **When**: Registered with an MCP server
- **Then**: Six tools are available: `issues_create`, `issues_get`, `issues_update`, `issues_list`, `issues_close`, `issues_delete`
- **Edge cases**:
  - All tools accept an optional `projectDir` that defaults to `cwd()`
  - `issues_update` supports state aliases via `parseState`
  - `issues_delete` wraps the boolean result in `{ deleted: boolean }`

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/issues/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: deno fmt --check src/issues/ && deno lint src/issues/

## Error Handling
- Zod `parse()` throws `ZodError` for invalid inputs to create/update/list operations
- File read errors (missing files) are caught and converted to `null` returns in `get`, `delete`, and `parseIssue`
- Directory creation errors are caught in `ensureDir`; only `EEXIST` is suppressed, others re-throw
- `listIds` silently returns empty array if the issues directory does not exist
- Invalid/malformed issue files are silently skipped during listing

## Side Effects
- **Filesystem writes**: `create` and `update` write markdown files to `{projectDir}/issues/`
- **Filesystem reads**: `get`, `list`, and `listIds` read from the issues directory
- **Filesystem deletes**: `delete` removes issue files
- **Directory creation**: `ensureDir` creates the `issues/` directory if missing

## Performance Constraints
- `list` reads every matching issue file sequentially (no parallel I/O)
- Sorting happens in-memory after all files are loaded
- No caching; every `get` call reads from disk

## Invariants
- Issue IDs always match `^(ISSUE|TASK|PLAN)-(\d{3,})$`
- Issue state is always `"open"` or `"closed"`
- `created_at` is set once at creation and never changes
- `updated_at` is refreshed on every mutation
- Labels and assignees arrays are never undefined on a persisted issue (default to `[]`)
- The `path` field on an `Issue` is always relative to the project directory: `issues/{ID}.md`
- `total` in `ListIssuesResult` reflects count before `limit` is applied
