import { MAX_ISSUE_LIST_LIMIT } from "veryfront/issues";
import type { CommandHelp } from "../../help/types.ts";

export const issuesHelp: CommandHelp = {
  name: "issues",
  category: "ai",
  description: "File-based issue tracking (SDLC conventions)",
  usage: "veryfront issues <command> [options]",
  options: [
    {
      flag: "--title, -t <title>",
      description: "Issue title (for create/edit)",
    },
    {
      flag: "--body, -b <body>",
      description: "Issue description in markdown (empty clears it during edit)",
    },
    {
      flag: "--labels, -l <labels>",
      description: "Comma-separated labels (empty clears them during edit)",
    },
    {
      flag: "--milestone, -m <name>",
      description: "Milestone to set or filter by (empty clears it during edit)",
    },
    {
      flag: "--assignees, -a <users>",
      description: "Comma-separated assignees (empty clears them during edit)",
    },
    {
      flag: "--assignee <user>",
      description: "Filter listed issues by one assignee",
    },
    {
      flag: "--state <state>",
      description: "Issue state: open or closed (edit accepts documented aliases)",
    },
    {
      flag: "--prefix <type>",
      description: "ID prefix: ISSUE, TASK, or PLAN (create defaults to ISSUE)",
    },
    {
      flag: "--sort <field>",
      description: "List sort field: created_at, updated_at, or id",
      default: "created_at",
    },
    {
      flag: "--dir <direction>",
      description: "List sort direction: asc or desc",
      default: "desc",
    },
    {
      flag: "--limit <count>",
      description: `Maximum list results (1 through ${MAX_ISSUE_LIST_LIMIT})`,
    },
    {
      flag: "--delete, -d",
      description: "Delete during edit instead of updating",
    },
    {
      flag: "--json, -j",
      description: "Output as JSON",
    },
    {
      flag: "--verbose",
      description: "Include timestamps and milestones in text lists",
    },
  ],
  examples: [
    'veryfront issues create --title "Fix login bug" --labels bug',
    "veryfront issues list --state open",
    "veryfront issues view ISSUE-001",
    "veryfront issues edit ISSUE-001 --state closed",
    "veryfront issues close TASK-042",
    'veryfront issues create --title "New feature" --prefix PLAN',
  ],
  notes: [
    "Issues are stored as markdown files in the issues/ directory",
    "File naming: ISSUE-001.md, TASK-001.md, PLAN-001.md",
    "Issued IDs have reservation markers in issues/.ids and are not reused after deletion",
    "Commit issues/.ids markers with issue changes to preserve reservations across clones",
    "Per-ID mutation locks are transient under issues/.locks; remove a stale lock only after verifying no writer is active",
    "Use TASK for small work items, PLAN for proposals/RFCs",
    "Labels support colon syntax for categorization (priority:high, type:bug)",
    "Also available via MCP tools: issues_create, issues_list, issues_update",
  ],
};
