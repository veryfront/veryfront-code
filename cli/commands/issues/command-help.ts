import type { CommandHelp } from "../../help/types.ts";

export const issuesHelp: CommandHelp = {
  name: "issues",
  category: "ai",
  description: "Manage file-backed project issues",
  usage: "veryfront issues <command> [options]",
  options: [
    {
      flag: "--title, -t <title>",
      description: "Set the issue title for create or edit",
    },
    {
      flag: "--body, -b <body>",
      description: "Set the issue description in Markdown",
    },
    {
      flag: "--labels, -l <labels>",
      description: "Set or filter by comma-separated labels",
    },
    {
      flag: "--state <state>",
      description: "Set or filter by issue state: open or closed",
    },
    {
      flag: "--prefix <type>",
      description: "ID prefix: ISSUE, TASK, or PLAN",
      default: "ISSUE",
    },
    {
      flag: "--milestone, -m <name>",
      description: "Set or filter by milestone",
    },
    {
      flag: "--assignees, -a <users>",
      description: "Set comma-separated assignees",
    },
    {
      flag: "--assignee <user>",
      description: "Filter by assignee",
    },
    {
      flag: "--sort <field>",
      description: "Sort by created_at, updated_at, or id",
    },
    {
      flag: "--dir <direction>",
      description: "Sort in asc or desc direction",
    },
    {
      flag: "--limit <count>",
      description: "Limit the number of returned issues",
    },
    {
      flag: "--delete, -d",
      description: "Delete the selected issue during edit",
    },
    {
      flag: "--json, -j",
      description: "Output as JSON",
    },
    {
      flag: "--verbose",
      description: "Show issue metadata in list output",
    },
  ],
  examples: [
    'veryfront issues create --title "Fix login bug" --labels bug',
    "veryfront issues list --state open",
    "veryfront issues view ISSUE-001",
    "veryfront issues edit ISSUE-001 --state closed",
    "veryfront issues close TASK-042",
    "veryfront issues reopen TASK-042",
    "veryfront issues delete PLAN-003",
    'veryfront issues create --title "New feature" --prefix PLAN',
  ],
  notes: [
    "Issues are stored as Markdown files in the issues/ directory.",
    "Files use identifiers such as ISSUE-001, TASK-001, and PLAN-001.",
    "TASK and PLAN are identifier prefixes. They do not change runtime execution semantics.",
    "Labels can use colon-delimited names such as priority:high and type:bug.",
    "MCP clients can use issues_create, issues_list, and issues_update.",
  ],
};
