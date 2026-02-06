import type { CommandHelp } from "../../help/types.ts";

export const issuesHelp: CommandHelp = {
  name: "issues",
  description: "File-based issue tracking (SDLC conventions)",
  usage: "veryfront issues <command> [options]",
  options: [
    {
      flag: "--title, -t <title>",
      description: "Issue title (for create/edit)",
    },
    {
      flag: "--body, -b <body>",
      description: "Issue description in markdown",
    },
    {
      flag: "--labels, -l <labels>",
      description: "Comma-separated labels (e.g., bug,priority:high)",
    },
    {
      flag: "--state <state>",
      description: "Issue state: open, closed",
    },
    {
      flag: "--prefix <type>",
      description: "ID prefix: ISSUE, TASK, or PLAN",
      default: "ISSUE",
    },
    {
      flag: "--json, -j",
      description: "Output as JSON",
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
    "Use TASK for small work items, PLAN for proposals/RFCs",
    "Labels support colon syntax for categorization (priority:high, type:bug)",
    "Also available via MCP tools: issues_create, issues_list, issues_update",
  ],
};
