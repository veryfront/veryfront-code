/**
 * CLI command for file-based issue tracking
 *
 * @module cli/commands/issues
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { cliLogger } from "#veryfront/utils";
import { createIssuesManager, type Issue, parseState } from "../../issues/index.ts";
import type { IssuePrefix } from "../../issues/schema.ts";

/**
 * Format a single issue for display
 */
function formatIssue(issue: Issue, verbose = false): string {
  const { metadata } = issue;
  const isOpen = metadata.state === "open";
  const stateIcon = isOpen ? "○" : "●";
  const stateColor = isOpen ? "\x1b[32m" : "\x1b[90m";
  const reset = "\x1b[0m";

  const labels = metadata.labels.length ? ` [${metadata.labels.join(", ")}]` : "";
  const assignees = metadata.assignees.length ? ` → ${metadata.assignees.join(", ")}` : "";

  let line =
    `${stateColor}${stateIcon}${reset} ${metadata.id}: ${metadata.title}${labels}${assignees}`;

  if (!verbose) return line;

  line += `\n  Created: ${metadata.created_at}`;
  line += `\n  Updated: ${metadata.updated_at}`;
  if (metadata.milestone) line += `\n  Milestone: ${metadata.milestone}`;

  return line;
}

/**
 * Format issue details (full view)
 */
function formatIssueDetails(issue: Issue): string {
  const { metadata, body } = issue;
  const lines: string[] = [];

  lines.push(`\x1b[1m${metadata.id}: ${metadata.title}\x1b[0m`);
  lines.push("");
  lines.push(`State:      ${metadata.state}`);
  lines.push(`Labels:     ${metadata.labels.join(", ") || "(none)"}`);
  lines.push(`Assignees:  ${metadata.assignees.join(", ") || "(none)"}`);
  lines.push(`Milestone:  ${metadata.milestone || "(none)"}`);
  lines.push(`Created:    ${metadata.created_at}`);
  lines.push(`Updated:    ${metadata.updated_at}`);
  lines.push(`Path:       ${issue.path}`);

  if (body) {
    lines.push("");
    lines.push("─".repeat(60));
    lines.push(body);
  }

  return lines.join("\n");
}

/**
 * Parse comma-separated labels
 */
function parseLabels(arg: string | undefined): string[] | undefined {
  if (!arg) return undefined;

  const values = arg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return values.length ? values : undefined;
}

function getJsonFlag(args: { json?: boolean; j?: boolean }): boolean {
  return Boolean(args.json || args.j);
}

function getId(args: { _: (string | number)[] }, index: number): string | undefined {
  const value = args._[index];
  return typeof value === "string" ? value : undefined;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function getPrefix(prefix: string | undefined, fallback?: IssuePrefix): IssuePrefix | undefined {
  const value = prefix?.toUpperCase() as IssuePrefix | undefined;
  return value ?? fallback;
}

export async function issuesCommand(args: {
  _: (string | number)[];
  title?: string;
  t?: string;
  body?: string;
  b?: string;
  labels?: string;
  l?: string;
  milestone?: string;
  m?: string;
  assignees?: string;
  a?: string;
  prefix?: string;
  state?: string;
  assignee?: string;
  json?: boolean;
  j?: boolean;
  verbose?: boolean;
  v?: boolean;
  delete?: boolean;
  d?: boolean;
  limit?: number;
  sort?: string;
  dir?: string;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}): Promise<void> {
  const subcommand = getId(args, 1);
  const manager = createIssuesManager(cwd());
  const json = getJsonFlag(args);
  const verbose = Boolean(args.verbose || args.v);

  switch (subcommand) {
    case "create": {
      const title = args.title || args.t || getId(args, 2);
      if (!title) {
        cliLogger.error("Title is required. Usage: veryfront issues create --title 'My issue'");
        return;
      }

      const issue = await manager.create({
        title,
        body: args.body || args.b,
        labels: parseLabels(args.labels || args.l),
        milestone: args.milestone || args.m,
        assignees: parseLabels(args.assignees || args.a),
        prefix: getPrefix(args.prefix, "ISSUE")!,
      });

      if (json) {
        printJson(issue);
        return;
      }

      cliLogger.info(`Created ${issue.metadata.id}: ${issue.metadata.title}`);
      cliLogger.info(`  Path: ${issue.path}`);
      return;
    }

    case "list":
    case "ls": {
      const result = await manager.list({
        state: args.state ? parseState(args.state) ?? undefined : undefined,
        labels: parseLabels(args.labels || args.l),
        milestone: args.milestone || args.m,
        assignee: args.assignee,
        prefix: getPrefix(args.prefix),
        sortBy: (args.sort as "created_at" | "updated_at" | "id") || "created_at",
        sortDirection: (args.dir as "asc" | "desc") || "desc",
        limit: args.limit,
      });

      if (json) {
        printJson(result);
        return;
      }

      if (!result.issues.length) {
        cliLogger.info("No issues found.");
        return;
      }

      for (const issue of result.issues) {
        console.log(formatIssue(issue, verbose));
      }

      if (result.total > result.issues.length) {
        cliLogger.info(`\nShowing ${result.issues.length} of ${result.total} issues`);
      }
      return;
    }

    case "view":
    case "show":
    case "get": {
      const id = getId(args, 2);
      if (!id) {
        cliLogger.error("Issue ID is required. Usage: veryfront issues view ISSUE-001");
        return;
      }

      const issue = await manager.get(id);
      if (!issue) {
        cliLogger.error(`Issue not found: ${id}`);
        return;
      }

      if (json) {
        printJson(issue);
        return;
      }

      console.log(formatIssueDetails(issue));
      return;
    }

    case "edit":
    case "update": {
      const id = getId(args, 2);
      if (!id) {
        cliLogger.error(
          "Issue ID is required. Usage: veryfront issues edit ISSUE-001 --state closed",
        );
        return;
      }

      if (args.delete || args.d) {
        const deleted = await manager.delete(id);
        if (deleted) cliLogger.info(`Deleted ${id}`);
        else cliLogger.error(`Failed to delete ${id}`);
        return;
      }

      const updates: Parameters<typeof manager.update>[1] = {};

      const title = args.title || args.t;
      if (title) updates.title = title;

      const body = args.body || args.b;
      if (body) updates.body = body;

      if (args.state) {
        const state = parseState(args.state);
        if (state) updates.state = state;
      }

      const labels = parseLabels(args.labels || args.l);
      if (labels) updates.labels = labels;

      const assignees = parseLabels(args.assignees || args.a);
      if (assignees) updates.assignees = assignees;

      const milestone = args.milestone || args.m;
      if (milestone) updates.milestone = milestone;

      if (!Object.keys(updates).length) {
        cliLogger.error("No updates provided. Use --title, --state, --labels, etc.");
        return;
      }

      const issue = await manager.update(id, updates);
      if (!issue) {
        cliLogger.error(`Issue not found: ${id}`);
        return;
      }

      if (json) {
        printJson(issue);
        return;
      }

      cliLogger.info(`Updated ${issue.metadata.id}`);
      console.log(formatIssue(issue, true));
      return;
    }

    case "close": {
      const id = getId(args, 2);
      if (!id) {
        cliLogger.error("Issue ID is required. Usage: veryfront issues close ISSUE-001");
        return;
      }

      const issue = await manager.close(id);
      if (!issue) {
        cliLogger.error(`Issue not found: ${id}`);
        return;
      }

      if (json) {
        printJson(issue);
        return;
      }

      cliLogger.info(`Closed ${issue.metadata.id}: ${issue.metadata.title}`);
      return;
    }

    case "reopen": {
      const id = getId(args, 2);
      if (!id) {
        cliLogger.error("Issue ID is required. Usage: veryfront issues reopen ISSUE-001");
        return;
      }

      const issue = await manager.reopen(id);
      if (!issue) {
        cliLogger.error(`Issue not found: ${id}`);
        return;
      }

      if (json) {
        printJson(issue);
        return;
      }

      cliLogger.info(`Reopened ${issue.metadata.id}: ${issue.metadata.title}`);
      return;
    }

    case "delete":
    case "rm": {
      const id = getId(args, 2);
      if (!id) {
        cliLogger.error("Issue ID is required. Usage: veryfront issues delete ISSUE-001");
        return;
      }

      const deleted = await manager.delete(id);
      if (deleted) cliLogger.info(`Deleted ${id}`);
      else cliLogger.error(`Issue not found: ${id}`);
      return;
    }

    default: {
      console.log(`
Veryfront Issues - File-based issue tracking

Usage: veryfront issues <command> [options]

Commands:
  create     Create a new issue
  list, ls   List issues with filtering
  view       View issue details
  edit       Update an issue
  close      Close an issue
  reopen     Reopen a closed issue
  delete     Delete an issue

Create Options:
  --title, -t <title>      Issue title (required)
  --body, -b <body>        Issue description
  --labels, -l <labels>    Comma-separated labels
  --milestone, -m <name>   Milestone name
  --assignees, -a <users>  Comma-separated assignees
  --prefix <type>          ID prefix: ISSUE, TASK, or PLAN

List Options:
  --state <state>          Filter by state (open/closed)
  --labels, -l <labels>    Filter by labels (comma-separated)
  --milestone, -m <name>   Filter by milestone
  --assignee <user>        Filter by assignee
  --prefix <type>          Filter by prefix (ISSUE/TASK/PLAN)
  --sort <field>           Sort by: created_at, updated_at, id
  --dir <direction>        Sort direction: asc, desc
  --limit <n>              Maximum results

Edit Options:
  --title, -t <title>      New title
  --body, -b <body>        New body content
  --state <state>          New state (open/closed)
  --labels, -l <labels>    Labels to set
  --delete, -d             Delete the issue

Global Options:
  --json, -j               Output as JSON
  --verbose                Show more details

Examples:
  veryfront issues create --title "Fix login bug" --labels bug,priority:high
  veryfront issues list --state open --labels bug
  veryfront issues view ISSUE-001
  veryfront issues edit ISSUE-001 --state closed
  veryfront issues close TASK-042
`);
      return;
    }
  }
}
