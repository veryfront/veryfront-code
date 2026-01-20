/**
 * Issues command - GitHub-compatible file-based issue tracking
 *
 * @example
 * ```bash
 * # Create issues
 * veryfront issues create --title "Fix login bug" --labels bug,priority:high
 *
 * # List issues
 * veryfront issues list
 * veryfront issues list --state open
 *
 * # View issue
 * veryfront issues view ISSUE-xxx
 *
 * # Edit issue
 * veryfront issues edit ISSUE-xxx --state closed
 *
 * # Sync with GitHub
 * veryfront issues sync
 * ```
 */

import { parseArgs } from "jsr:@std/cli@1.0.11/parse-args"
import { cliLogger } from "#veryfront/utils"
import {
  createResource,
  deleteResource,
  filterResources,
  getStats,
  listAllResources,
  readResource,
  updateResource,
  type IssueType,
  type IssueState,
} from "#veryfront/issues/index.ts"
import {
  pullFromGitHub,
  pushToGitHub,
  sync,
  type SyncConfig,
} from "#veryfront/issues/sync.ts"

/**
 * Main issues command handler
 */
export async function issuesCommand(projectDir: string): Promise<void> {
  // Get args after 'issues' command
  const issuesIndex = Deno.args.indexOf("issues")
  const args = issuesIndex >= 0 ? Deno.args.slice(issuesIndex + 1) : []

  const parsedArgs = parseArgs(args, {
    string: [
      "title",
      "type",
      "state",
      "labels",
      "milestone",
      "assignee",
      "content",
      "owner",
      "repo",
      "token",
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
    case "sync":
      await syncCommand(projectDir, parsedArgs)
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
  const type = (args.type || "issue") as IssueType

  if (!["issue", "plan", "milestone"].includes(type)) {
    cliLogger.error("Invalid type. Must be: issue, plan, or milestone")
    return
  }

  const title = args.title
  if (!title) {
    cliLogger.error("--title is required")
    return
  }

  // Parse labels
  const labels: string[] = args.labels ? args.labels.split(",").map((l: string) => l.trim()) : []

  // Parse assignees
  const assignees: string[] = args.assignee ? [args.assignee] : []

  const content = args.content || `# ${title}\n\n[Add description here]`

  const resource = await createResource(
    {
      title,
      type,
      labels,
      milestone: args.milestone,
      assignees,
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
  let resources = await listAllResources(projectDir)

  // Apply filters
  const filters: any = {}
  if (args.type) {
    filters.type = args.type
  }
  if (args.state) {
    filters.state = args.state.split(",")
  }
  if (args.milestone) {
    filters.milestone = args.milestone
  }
  if (args.assignee) {
    filters.assignee = args.assignee
  }
  if (args.labels) {
    filters.labels = args.labels.split(",").map((l: string) => l.trim())
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

  // Group by state
  const byState: Record<IssueState, typeof resources> = {
    open: [],
    closed: [],
  }

  for (const resource of resources) {
    byState[resource.metadata.state].push(resource)
  }

  console.log()

  // Print open issues first
  if (byState.open.length > 0) {
    console.log(`🟢 open (${byState.open.length})`)
    console.log()
    for (const resource of byState.open) {
      const { metadata } = resource
      const labels = metadata.labels.join(", ")
      const assignees = metadata.assignees.length > 0 ? ` · @${metadata.assignees.join(", @")}` : ""
      console.log(`  ${metadata.title}${assignees}`)
      if (labels) {
        console.log(`    ${labels}`)
      }
    }
    console.log()
  }

  // Print closed issues
  if (byState.closed.length > 0) {
    console.log(`⚫ closed (${byState.closed.length})`)
    console.log()
    for (const resource of byState.closed) {
      const { metadata } = resource
      console.log(`  ${metadata.title}`)
    }
    console.log()
  }

  console.log(`${resources.length} issue${resources.length !== 1 ? "s" : ""}`)
  console.log()
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

  // Clean header
  console.log()
  console.log(metadata.title)
  console.log()

  // Metadata
  const stateIcon = metadata.state === "open" ? "🟢" : "⚫"
  console.log(`${stateIcon} ${metadata.state}`)

  if (metadata.labels.length > 0) {
    console.log(`Labels: ${metadata.labels.join(", ")}`)
  }
  if (metadata.assignees.length > 0) {
    console.log(`Assignees: @${metadata.assignees.join(", @")}`)
  }
  if (metadata.milestone) {
    console.log(`Milestone: ${metadata.milestone}`)
  }
  if (metadata.number) {
    console.log(`GitHub: #${metadata.number}`)
  }

  console.log()
  console.log("─".repeat(60))
  console.log()
  console.log(content)
  console.log()
  console.log("─".repeat(60))
  console.log(`issues/${metadata.id}.md`)
  console.log()
}

/**
 * Edit an issue
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
      cliLogger.info(`✓ Deleted: ${id}`)
    } else {
      cliLogger.error(`Failed to delete issue: ${id}`)
    }
    return
  }

  // Build updates
  const updates: any = { id }
  if (args.state) updates.state = args.state as IssueState
  if (args.title) updates.title = args.title
  if (args.labels) updates.labels = args.labels.split(",").map((l: string) => l.trim())
  if (args.assignee) updates.assignees = [args.assignee]
  if (args.milestone) updates.milestone = args.milestone
  if (args.content) updates.content = args.content

  if (Object.keys(updates).length === 1) {
    cliLogger.error("No updates specified. Use --delete to delete the issue.")
    return
  }

  const updated = await updateResource(updates, projectDir)

  if (!updated) {
    cliLogger.error(`Failed to update issue: ${id}`)
    return
  }

  cliLogger.info(`✓ Updated: ${id}`)

  if (args.json) {
    console.log(JSON.stringify(updated, null, 2))
  }
}

/**
 * Sync with GitHub
 */
async function syncCommand(projectDir: string, args: any): Promise<void> {
  const syncMode = args._[1] as string | undefined

  // Get GitHub config
  const owner = args.owner || Deno.env.get("GITHUB_OWNER")
  const repo = args.repo || Deno.env.get("GITHUB_REPO")
  const token = args.token || Deno.env.get("GITHUB_TOKEN")

  if (!owner || !repo || !token) {
    cliLogger.error("GitHub configuration required:")
    cliLogger.error("  --owner <owner> or GITHUB_OWNER env var")
    cliLogger.error("  --repo <repo> or GITHUB_REPO env var")
    cliLogger.error("  --token <token> or GITHUB_TOKEN env var")
    return
  }

  const config: SyncConfig = { owner, repo, token }

  try {
    let stats

    switch (syncMode) {
      case "pull":
        cliLogger.info(`Pulling issues from ${owner}/${repo}...`)
        stats = await pullFromGitHub(config, projectDir)
        break
      case "push":
        cliLogger.info(`Pushing issues to ${owner}/${repo}...`)
        stats = await pushToGitHub(config, projectDir)
        break
      default:
        cliLogger.info(`Syncing issues with ${owner}/${repo}...`)
        stats = await sync(config, projectDir)
    }

    console.log()
    cliLogger.info("Sync complete!")
    console.log(`  Pulled: ${stats.pulled}`)
    console.log(`  Pushed: ${stats.pushed}`)
    console.log(`  Updated: ${stats.updated}`)
    if (stats.errors > 0) {
      console.log(`  Errors: ${stats.errors}`)
    }
    console.log()

    if (args.json) {
      console.log(JSON.stringify(stats, null, 2))
    }
  } catch (error) {
    cliLogger.error("Sync failed:", error)
    Deno.exit(1)
  }
}

/**
 * Print help
 */
function printHelp(): void {
  console.log(`
veryfront issues - GitHub-compatible file-based issue tracking

USAGE:
  veryfront issues <subcommand> [options]

SUBCOMMANDS:
  create              Create a new issue
  list                List issues
  view <id>           View issue details
  edit <id> [options] Edit or delete issue
  sync [pull|push]    Sync with GitHub Issues

CREATE OPTIONS:
  --title <string>     Issue title (required)
  --type <type>        Type: issue, plan, milestone (default: issue)
  --labels <list>      Comma-separated labels (e.g., bug,priority:high)
  --milestone <name>   Milestone name
  --assignee <user>    Assignee username
  --content <markdown> Issue content

LIST OPTIONS:
  --type <type>        Filter by type
  --state <state>      Filter by state: open, closed
  --labels <list>      Filter by labels
  --milestone <name>   Filter by milestone
  --assignee <user>    Filter by assignee

EDIT OPTIONS:
  --state <state>      New state: open, closed
  --title <string>     New title
  --labels <list>      New labels
  --assignee <user>    New assignee
  --milestone <name>   New milestone
  --content <markdown> New content
  --delete, -d         Delete the issue

SYNC OPTIONS:
  --owner <owner>      GitHub repository owner (or GITHUB_OWNER env var)
  --repo <repo>        GitHub repository name (or GITHUB_REPO env var)
  --token <token>      GitHub token (or GITHUB_TOKEN env var)

GLOBAL OPTIONS:
  --json               Output as JSON
  --help, -h           Show this help

EXAMPLES:
  # Create
  veryfront issues create --title "Fix login bug" --labels bug,priority:high
  veryfront issues create --title "Auth system spec" --type plan

  # List
  veryfront issues list
  veryfront issues list --state open --labels bug

  # View
  veryfront issues view ISSUE-xxx

  # Edit
  veryfront issues edit ISSUE-xxx --state closed
  veryfront issues edit ISSUE-xxx --labels bug,fixed

  # Delete
  veryfront issues edit ISSUE-xxx --delete

  # Sync with GitHub
  export GITHUB_OWNER=org
  export GITHUB_REPO=repo
  export GITHUB_TOKEN=ghp_xxx
  veryfront issues sync        # Bi-directional
  veryfront issues sync pull   # Pull only
  veryfront issues sync push   # Push only

FILE FORMAT:
  issues/
  ├── ISSUE-xxx.md
  ├── PLAN-xxx.md
  └── MILESTONE-xxx.md

  Each file:
  ---
  id: ISSUE-xxx
  title: Fix login bug
  state: open
  labels:
    - bug
    - priority:high
  assignees:
    - username
  created_at: 2024-01-01T00:00:00Z
  updated_at: 2024-01-01T00:00:00Z
  ---
  # Description

  Issue content here...

TYPES:
  issue     - Bug, feature, enhancement
  plan      - Spec, design doc, implementation plan
  milestone - Release milestone

LABELS (conventions):
  bug, enhancement, documentation
  priority:low, priority:medium, priority:high, priority:critical
  status:in_progress, status:blocked, status:in_review
  type:issue, type:plan, type:milestone
`)
}
