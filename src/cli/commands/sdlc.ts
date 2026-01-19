/**
 * SDLC command - Manage tasks, issues, plans, milestones, and RFCs
 *
 * @example
 * ```bash
 * # Create a new task
 * veryfront sdlc create task --title "Implement JWT auth" --priority high
 *
 * # List all tasks
 * veryfront sdlc list tasks
 *
 * # List issues by status
 * veryfront sdlc list issues --status todo,in_progress
 *
 * # Update task status
 * veryfront sdlc update TASK-001 --status in_progress
 *
 * # Show statistics
 * veryfront sdlc stats
 * ```
 */

import { parseArgs } from "#std/cli/parse-args.ts"
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
 * Main SDLC command handler
 */
export async function sdlcCommand(
  projectDir: string,
  args: string[],
): Promise<void> {
  const parsedArgs = parseArgs(args, {
    string: [
      "title",
      "status",
      "priority",
      "milestone",
      "assignee",
      "kind",
      "content",
    ],
    boolean: ["json", "help"],
    alias: {
      h: "help",
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
    case "ls":
      await listCommand(projectDir, parsedArgs)
      break
    case "show":
    case "view":
      await showCommand(projectDir, parsedArgs)
      break
    case "update":
      await updateCommand(projectDir, parsedArgs)
      break
    case "delete":
    case "rm":
      await deleteCommand(projectDir, parsedArgs)
      break
    case "stats":
      await statsCommand(projectDir, parsedArgs)
      break
    case "discover":
      await discoverCommand(projectDir, parsedArgs)
      break
    default:
      cliLogger.error(`Unknown subcommand: ${subcommand}`)
      printHelp()
      Deno.exit(1)
  }
}

/**
 * Create a new SDLC resource
 */
async function createCommand(projectDir: string, args: any): Promise<void> {
  const type = args._[1] as SdlcResourceType

  if (!type || !["task", "issue", "plan", "milestone", "rfc"].includes(type)) {
    cliLogger.error("Invalid resource type. Must be: task, issue, plan, milestone, or rfc")
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

  cliLogger.success(`Created ${type}: ${resource.metadata.id}`)
  if (!args.json) {
    cliLogger.info(`Path: ${resource.path}`)
  }

  if (args.json) {
    console.log(JSON.stringify(resource, null, 2))
  }
}

/**
 * List SDLC resources
 */
async function listCommand(projectDir: string, args: any): Promise<void> {
  const type = args._[1] as SdlcResourceType | "all"

  let resources
  if (type && type !== "all") {
    resources = await listResources(type, projectDir)
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
    cliLogger.info("No resources found")
    return
  }

  cliLogger.info(`\nFound ${resources.length} resource(s):\n`)
  for (const resource of resources) {
    const { metadata } = resource
    const statusIcon = getStatusIcon(metadata.status)
    const priorityBadge = "priority" in metadata
      ? ` [${metadata.priority}]`
      : ""

    cliLogger.info(
      `${statusIcon} ${metadata.type.toUpperCase()}-${metadata.id.split("-")[1]} ${metadata.title}${priorityBadge}`,
    )
    if ("assignee" in metadata && metadata.assignee) {
      cliLogger.info(`   Assignee: ${metadata.assignee}`)
    }
  }
  console.log()
}

/**
 * Show a single SDLC resource
 */
async function showCommand(projectDir: string, args: any): Promise<void> {
  const id = args._[1] as string
  const type = args._[2] as SdlcResourceType | undefined

  if (!id) {
    cliLogger.error("Resource ID is required")
    return
  }

  // If type not specified, search all types
  let resource
  if (type) {
    resource = await readResource(type, id, projectDir)
  } else {
    // Try all types
    for (const t of ["task", "issue", "plan", "milestone", "rfc"] as SdlcResourceType[]) {
      resource = await readResource(t, id, projectDir)
      if (resource) break
    }
  }

  if (!resource) {
    cliLogger.error(`Resource not found: ${id}`)
    return
  }

  if (args.json) {
    console.log(JSON.stringify(resource, null, 2))
    return
  }

  const { metadata, content } = resource
  console.log(`\n${"=".repeat(60)}`)
  console.log(`${metadata.type.toUpperCase()}: ${metadata.title}`)
  console.log(`ID: ${metadata.id}`)
  console.log(`Status: ${metadata.status}`)
  if ("priority" in metadata) {
    console.log(`Priority: ${metadata.priority}`)
  }
  if ("assignee" in metadata && metadata.assignee) {
    console.log(`Assignee: ${metadata.assignee}`)
  }
  if ("milestone" in metadata && metadata.milestone) {
    console.log(`Milestone: ${metadata.milestone}`)
  }
  console.log(`Created: ${metadata.created}`)
  console.log(`Updated: ${metadata.updated}`)
  console.log(`${"=".repeat(60)}\n`)
  console.log(content)
  console.log()
}

/**
 * Update an SDLC resource
 */
async function updateCommand(projectDir: string, args: any): Promise<void> {
  const id = args._[1] as string
  const type = args._[2] as SdlcResourceType | undefined

  if (!id) {
    cliLogger.error("Resource ID is required")
    return
  }

  // Find resource type if not specified
  let resourceType = type
  if (!resourceType) {
    for (const t of ["task", "issue", "plan", "milestone", "rfc"] as SdlcResourceType[]) {
      const r = await readResource(t, id, projectDir)
      if (r) {
        resourceType = t
        break
      }
    }
  }

  if (!resourceType) {
    cliLogger.error(`Resource not found: ${id}`)
    return
  }

  // Build update metadata
  const updates: any = {}
  if (args.status) updates.status = args.status
  if (args.title) updates.title = args.title
  if (args.priority) updates.priority = args.priority
  if (args.assignee) updates.assignee = args.assignee
  if (args.milestone) updates.milestone = args.milestone

  if (Object.keys(updates).length === 0) {
    cliLogger.error("No updates specified")
    return
  }

  const updated = await updateResource(
    {
      type: resourceType,
      id,
      metadata: updates,
      content: args.content,
    },
    projectDir,
  )

  if (!updated) {
    cliLogger.error(`Failed to update resource: ${id}`)
    return
  }

  cliLogger.success(`Updated ${resourceType}: ${id}`)

  if (args.json) {
    console.log(JSON.stringify(updated, null, 2))
  }
}

/**
 * Delete an SDLC resource
 */
async function deleteCommand(projectDir: string, args: any): Promise<void> {
  const id = args._[1] as string
  const type = args._[2] as SdlcResourceType | undefined

  if (!id) {
    cliLogger.error("Resource ID is required")
    return
  }

  // Find resource type if not specified
  let resourceType = type
  if (!resourceType) {
    for (const t of ["task", "issue", "plan", "milestone", "rfc"] as SdlcResourceType[]) {
      const r = await readResource(t, id, projectDir)
      if (r) {
        resourceType = t
        break
      }
    }
  }

  if (!resourceType) {
    cliLogger.error(`Resource not found: ${id}`)
    return
  }

  const deleted = await deleteResource(resourceType, id, projectDir)

  if (deleted) {
    cliLogger.success(`Deleted ${resourceType}: ${id}`)
  } else {
    cliLogger.error(`Failed to delete resource: ${id}`)
  }
}

/**
 * Show SDLC statistics
 */
async function statsCommand(projectDir: string, args: any): Promise<void> {
  const stats = await getStats(projectDir)

  if (args.json) {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  console.log("\nSDLC Statistics\n")
  console.log(`Total Resources: ${stats.total}\n`)

  console.log("By Type:")
  for (const [type, count] of Object.entries(stats.byType)) {
    if (count > 0) {
      console.log(`  ${type}: ${count}`)
    }
  }

  console.log("\nBy Status:")
  for (const [status, count] of Object.entries(stats.byStatus)) {
    if (count > 0) {
      const icon = getStatusIcon(status as SdlcStatus)
      console.log(`  ${icon} ${status}: ${count}`)
    }
  }

  console.log("\nBy Priority:")
  for (const [priority, count] of Object.entries(stats.byPriority)) {
    if (count > 0) {
      console.log(`  ${priority}: ${count}`)
    }
  }
  console.log()
}

/**
 * Discover all SDLC resources
 */
async function discoverCommand(projectDir: string, args: any): Promise<void> {
  const { resources, stats } = await discoverResources(projectDir)

  if (args.json) {
    console.log(JSON.stringify({ resources, stats }, null, 2))
    return
  }

  cliLogger.success(`Discovered ${resources.length} SDLC resources`)
  console.log()
  statsCommand(projectDir, args)
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
 * Print help message
 */
function printHelp(): void {
  console.log(`
veryfront sdlc - Manage SDLC resources

USAGE:
  veryfront sdlc <subcommand> [options]

SUBCOMMANDS:
  create <type>     Create a new resource (task, issue, plan, milestone, rfc)
  list [type]       List resources (optionally filter by type)
  show <id>         Show a specific resource
  update <id>       Update a resource
  delete <id>       Delete a resource
  stats             Show statistics
  discover          Discover all resources

CREATE OPTIONS:
  --title <string>      Resource title (required)
  --status <status>     Status (default: todo)
  --priority <level>    Priority (low, medium, high, critical)
  --milestone <id>      Milestone ID
  --assignee <name>     Assignee name
  --kind <type>         Issue kind (bug, feature, enhancement, documentation)
  --content <markdown>  Resource content

LIST OPTIONS:
  --status <statuses>   Filter by status (comma-separated)
  --milestone <id>      Filter by milestone
  --assignee <name>     Filter by assignee

UPDATE OPTIONS:
  --status <status>     New status
  --title <string>      New title
  --priority <level>    New priority
  --assignee <name>     New assignee
  --milestone <id>      New milestone

GLOBAL OPTIONS:
  --json                Output as JSON
  --help, -h            Show this help

EXAMPLES:
  # Create a new task
  veryfront sdlc create task --title "Implement JWT auth" --priority high

  # List all tasks
  veryfront sdlc list task

  # List in-progress issues
  veryfront sdlc list issue --status in_progress

  # Update task status
  veryfront sdlc update TASK-001 --status done

  # Show resource details
  veryfront sdlc show TASK-001

  # Delete a resource
  veryfront sdlc delete TASK-001

  # Show statistics
  veryfront sdlc stats
`)
}
