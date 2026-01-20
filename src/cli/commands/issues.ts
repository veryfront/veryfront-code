/**
 * Issues command - Manage issues (tasks, bugs, features, plans, milestones, RFCs)
 *
 * @example
 * ```bash
 * # Create issues
 * veryfront issues create --title "Implement JWT auth" --type task --priority high
 * veryfront issues create --title "Login bug" --type issue --kind bug
 *
 * # List issues
 * veryfront issues list
 * veryfront issues list --status todo,in_progress
 * veryfront issues list --type task
 *
 * # Show issue
 * veryfront issues show TASK-001
 *
 * # Update issue
 * veryfront issues update TASK-001 --status done
 *
 * # Delete issue
 * veryfront issues delete TASK-001
 *
 * # Statistics
 * veryfront issues stats
 * ```
 */

import { parseArgs } from "jsr:@std/cli@1.0.11/parse-args"
import { cliLogger } from "#veryfront/utils"
import {
  createResource,
  deleteResource,
  discoverResources,
  filterResources,
  getStats,
  listAllResources,
  listResources,
  readResource,
  updateResource,
  type SdlcResourceType,
  type SdlcStatus,
  type SdlcPriority,
} from "#veryfront/sdlc/index.ts"

/**
 * Main issues command handler
 */
export async function issuesCommand(
  projectDir: string,
): Promise<void> {
  // Get args after 'issues' command
  const issuesIndex = Deno.args.indexOf("issues")
  const args = issuesIndex >= 0 ? Deno.args.slice(issuesIndex + 1) : []

  const parsedArgs = parseArgs(args, {
    string: [
      "title",
      "type",
      "status",
      "priority",
      "milestone",
      "assignee",
      "kind",
      "content",
    ],
    boolean: ["json", "help", "delete"],
    alias: {
      h: "help",
      t: "type",
      d: "delete",
    },
  })

  const subcommand = parsedArgs._[0] as string

  if (parsedArgs.help || !subcommand) {
    printHelp()
    return
  }

  switch (subcommand) {
    case "create":
      await createCommand(projectDir, parsedArgs)
      break
    case "list":
      await listCommand(projectDir, parsedArgs)
      break
    case "view":
      await viewCommand(projectDir, parsedArgs)
      break
    case "edit":
      await editCommand(projectDir, parsedArgs)
      break
    default:
      cliLogger.error(`Unknown subcommand: ${subcommand}`)
      printHelp()
      Deno.exit(1)
  }
}

/**
 * Create a new issue
 */
async function createCommand(projectDir: string, args: any): Promise<void> {
  const type = (args.type || "issue") as SdlcResourceType

  if (!["task", "issue", "plan", "milestone", "rfc"].includes(type)) {
    cliLogger.error("Invalid type. Must be: task, issue, plan, milestone, or rfc")
    return
  }

  const title = args.title
  if (!title) {
    cliLogger.error("--title is required")
    return
  }

  const status = (args.status || "todo") as SdlcStatus
  const priority = (args.priority || "medium") as SdlcPriority

  // Build metadata based on type
  let metadata: any = {
    title,
    status,
  }

  if (type === "task" || type === "issue") {
    metadata.priority = priority
    if (args.milestone) metadata.milestone = args.milestone
    if (args.assignee) metadata.assignee = args.assignee
  }

  if (type === "issue") {
    metadata.kind = args.kind || "feature"
  }

  if (type === "milestone") {
    metadata.progress = 0
  }

  const content = args.content || `# ${title}\n\n[Add description here]`

  const resource = await createResource(
    {
      type,
      metadata,
      content,
    },
    projectDir,
  )

  cliLogger.info(`✓ Created ${type}: ${resource.metadata.id}`)
  if (!args.json) {
    cliLogger.info(`  File: issues/${resource.metadata.id}.md`)
  }

  if (args.json) {
    console.log(JSON.stringify(resource, null, 2))
  }
}

/**
 * List issues
 */
async function listCommand(projectDir: string, args: any): Promise<void> {
  const typeFilter = args.type as SdlcResourceType | undefined

  let resources
  if (typeFilter) {
    resources = await listResources(typeFilter, projectDir)
  } else {
    resources = await listAllResources(projectDir)
  }

  // Apply filters
  const filters: any = {}
  if (args.status) {
    filters.status = args.status.split(",")
  }
  if (args.milestone) {
    filters.milestone = args.milestone
  }
  if (args.assignee) {
    filters.assignee = args.assignee
  }

  if (Object.keys(filters).length > 0) {
    resources = filterResources(resources, filters)
  }

  if (args.json) {
    console.log(JSON.stringify(resources, null, 2))
    return
  }

  if (resources.length === 0) {
    cliLogger.info("No issues found")
    return
  }

  // Group by status for board view
  const byStatus: Record<string, typeof resources> = {
    todo: [],
    in_progress: [],
    blocked: [],
    in_review: [],
    done: [],
    cancelled: [],
  }

  for (const resource of resources) {
    if (byStatus[resource.metadata.status]) {
      byStatus[resource.metadata.status].push(resource)
    }
  }

  console.log(`\nFound ${resources.length} issue(s):\n`)

  // Print by status lanes (kanban style)
  for (const [status, items] of Object.entries(byStatus)) {
    if (items.length === 0) continue

    const statusIcon = getStatusIcon(status as SdlcStatus)
    console.log(`${statusIcon} ${status.toUpperCase().replace(/_/g, " ")} (${items.length})`)
    console.log("─".repeat(60))

    for (const resource of items) {
      const { metadata } = resource
      const typeTag = `[${metadata.type}]`
      const priorityBadge = "priority" in metadata
        ? ` ${getPriorityIcon(metadata.priority as SdlcPriority)}`
        : ""

      console.log(`  ${typeTag} ${metadata.id}`)
      console.log(`  ${metadata.title}${priorityBadge}`)
      if ("assignee" in metadata && metadata.assignee) {
        console.log(`  @${metadata.assignee}`)
      }
      console.log()
    }
  }
}

/**
 * View a single issue
 */
async function viewCommand(projectDir: string, args: any): Promise<void> {
  const id = args._[1] as string

  if (!id) {
    cliLogger.error("Issue ID is required")
    return
  }

  const resource = await readResource(id, projectDir)

  if (!resource) {
    cliLogger.error(`Issue not found: ${id}`)
    return
  }

  if (args.json) {
    console.log(JSON.stringify(resource, null, 2))
    return
  }

  const { metadata, content } = resource
  console.log(`\n${"=".repeat(60)}`)
  console.log(`[${metadata.type.toUpperCase()}] ${metadata.title}`)
  console.log(`${"=".repeat(60)}`)
  console.log(`ID: ${metadata.id}`)
  console.log(`Status: ${getStatusIcon(metadata.status)} ${metadata.status}`)
  if ("priority" in metadata) {
    console.log(`Priority: ${getPriorityIcon(metadata.priority)} ${metadata.priority}`)
  }
  if ("assignee" in metadata && metadata.assignee) {
    console.log(`Assignee: @${metadata.assignee}`)
  }
  if ("milestone" in metadata && metadata.milestone) {
    console.log(`Milestone: ${metadata.milestone}`)
  }
  console.log(`Created: ${metadata.created}`)
  console.log(`Updated: ${metadata.updated}`)
  console.log(`File: issues/${metadata.id}.md`)
  console.log(`${"=".repeat(60)}\n`)
  console.log(content)
  console.log()
}

/**
 * Edit an issue (update status, metadata, or delete)
 */
async function editCommand(projectDir: string, args: any): Promise<void> {
  const id = args._[1] as string

  if (!id) {
    cliLogger.error("Issue ID is required")
    return
  }

  // Check if resource exists
  const existing = await readResource(id, projectDir)
  if (!existing) {
    cliLogger.error(`Issue not found: ${id}`)
    return
  }

  // Handle delete flag
  if (args.delete) {
    const deleted = await deleteResource(id, projectDir)
    if (deleted) {
      cliLogger.info(`✓ Deleted ${existing.metadata.type}: ${id}`)
    } else {
      cliLogger.error(`Failed to delete issue: ${id}`)
    }
    return
  }

  // Build update metadata
  const updates: any = {}
  if (args.status) updates.status = args.status
  if (args.title) updates.title = args.title
  if (args.priority) updates.priority = args.priority
  if (args.assignee) updates.assignee = args.assignee
  if (args.milestone) updates.milestone = args.milestone

  if (Object.keys(updates).length === 0 && !args.content) {
    cliLogger.error("No updates specified. Use --delete to delete the issue.")
    return
  }

  const updated = await updateResource(
    {
      id,
      metadata: updates,
      content: args.content,
    },
    projectDir,
  )

  if (!updated) {
    cliLogger.error(`Failed to update issue: ${id}`)
    return
  }

  cliLogger.info(`✓ Updated ${existing.metadata.type}: ${id}`)

  if (args.json) {
    console.log(JSON.stringify(updated, null, 2))
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: SdlcStatus): string {
  const icons: Record<SdlcStatus, string> = {
    todo: "⭕",
    in_progress: "🔄",
    blocked: "🚫",
    in_review: "👀",
    done: "✅",
    cancelled: "❌",
  }
  return icons[status] || "❓"
}

/**
 * Get priority icon
 */
function getPriorityIcon(priority: SdlcPriority): string {
  const icons: Record<SdlcPriority, string> = {
    low: "🔵",
    medium: "🟡",
    high: "🟠",
    critical: "🔴",
  }
  return icons[priority] || "⚪"
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
veryfront issues - Manage issues in issues/ folder

USAGE:
  veryfront issues <subcommand> [options]

SUBCOMMANDS:
  create            Create a new issue
  list              List issues (kanban board view)
  view <id>         View issue details
  edit <id>         Edit issue (or delete with --delete flag)

CREATE OPTIONS:
  --title <string>      Issue title (required)
  --type <type>         Type: task, issue, plan, milestone, rfc (default: issue)
  --status <status>     Status (default: todo)
  --priority <level>    Priority: low, medium, high, critical
  --milestone <id>      Milestone ID
  --assignee <name>     Assignee name
  --kind <type>         Issue kind: bug, feature, enhancement, documentation
  --content <markdown>  Issue content

LIST OPTIONS:
  --type <type>         Filter by type
  --status <statuses>   Filter by status (comma-separated)
  --milestone <id>      Filter by milestone
  --assignee <name>     Filter by assignee

EDIT OPTIONS:
  --status <status>     New status
  --title <string>      New title
  --priority <level>    New priority
  --assignee <name>     New assignee
  --milestone <id>      New milestone
  --content <markdown>  New content
  --delete, -d          Delete the issue

GLOBAL OPTIONS:
  --json                Output as JSON
  --help, -h            Show this help

EXAMPLES:
  # Create
  veryfront issues create --title "Implement JWT auth" --type task --priority high
  veryfront issues create --title "Login bug" --type issue --kind bug

  # List (kanban board)
  veryfront issues list
  veryfront issues list --type task --status todo,in_progress

  # View
  veryfront issues view TASK-1234567-abc123

  # Edit (update status, priority, etc)
  veryfront issues edit TASK-1234567-abc123 --status done
  veryfront issues edit ISSUE-1234567-def456 --assignee alice --priority high

  # Delete
  veryfront issues edit TASK-1234567-abc123 --delete

NOTES:
  - All issues stored in issues/ folder as markdown files
  - Each file has YAML frontmatter with metadata
  - Edit files directly or use CLI commands
  - Changes to files update the issue automatically
  - Git-friendly, AI-native format
`)
}
