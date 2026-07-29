/**
 * CLI command for file-based issue tracking
 *
 * @module cli/commands/issues
 */

import { cwd } from "veryfront/platform";
import { cliLogger } from "#cli/utils";
import {
  createIssuesManager,
  type Issue,
  ISSUE_PREFIXES,
  type IssuePrefix,
  type IssueState,
  MAX_ISSUE_LIST_LIMIT,
  parseState,
} from "veryfront/issues";
import { INVALID_ARGUMENT, RESOURCE_NOT_FOUND } from "veryfront/errors";
import { bold, muted, success } from "#cli/ui";

import type { ParsedArgs } from "#cli/shared/types";
import { printJson } from "../../shared/json-output.ts";
import { getNumberArg, getStringArg } from "../../shared/parsed-args.ts";

/** Extract a boolean value from parsed args by checking multiple keys */
function bool(args: ParsedArgs, ...keys: string[]): boolean {
  for (const k of keys) {
    if (args[k]) return true;
  }
  return false;
}

/**
 * Format a single issue for display
 */
function formatIssue(issue: Issue, verbose = false): string {
  const { metadata } = issue;
  const isOpen = metadata.state === "open";
  const stateIcon = isOpen ? "○" : "●";
  const colorFn = isOpen ? success : muted;

  const labels = metadata.labels.length ? ` [${metadata.labels.join(", ")}]` : "";
  const assignees = metadata.assignees.length ? ` → ${metadata.assignees.join(", ")}` : "";

  let line = `${colorFn(stateIcon)} ${metadata.id}: ${metadata.title}${labels}${assignees}`;

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

  lines.push(bold(`${metadata.id}: ${metadata.title}`));
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

function getJsonFlag(args: ParsedArgs): boolean {
  return Boolean(args.json || args.j);
}

function getId(args: ParsedArgs, index: number): string | undefined {
  const value = args._[index];
  return typeof value === "string" ? value : undefined;
}

function isIssuePrefix(value: string): value is IssuePrefix {
  return ISSUE_PREFIXES.some((prefix) => prefix === value);
}
function getPrefix(prefix: string | undefined, fallback?: IssuePrefix): IssuePrefix | undefined {
  if (prefix === undefined) return fallback;
  const value = prefix.trim().toUpperCase();
  if (!isIssuePrefix(value)) {
    throw INVALID_ARGUMENT.create({
      detail: `Unsupported issue prefix: ${prefix}`,
    });
  }
  return value;
}

function parseStateArg(value: string): IssueState {
  const state = parseState(value);
  if (!state) {
    throw INVALID_ARGUMENT.create({
      detail: `Unsupported issue state: ${value}`,
    });
  }
  return state;
}

const ISSUE_SORT_FIELDS = ["created_at", "updated_at", "id"] as const;
type IssueSortField = (typeof ISSUE_SORT_FIELDS)[number];
const ISSUE_SORT_DIRECTIONS = ["asc", "desc"] as const;
type IssueSortDirection = (typeof ISSUE_SORT_DIRECTIONS)[number];

function isIssueSortField(value: string): value is IssueSortField {
  return ISSUE_SORT_FIELDS.some((field) => field === value);
}

function isIssueSortDirection(value: string): value is IssueSortDirection {
  return ISSUE_SORT_DIRECTIONS.some((direction) => direction === value);
}

function getSortField(value: string | undefined): IssueSortField {
  if (value === undefined) return "created_at";
  if (isIssueSortField(value)) return value;
  throw INVALID_ARGUMENT.create({
    detail: `Unsupported issue sort field: ${value}`,
  });
}

function getSortDirection(value: string | undefined): IssueSortDirection {
  if (value === undefined) return "desc";
  if (isIssueSortDirection(value)) return value;
  throw INVALID_ARGUMENT.create({
    detail: `Unsupported issue sort direction: ${value}`,
  });
}

function getLimit(args: ParsedArgs): number | undefined {
  if (args.limit === undefined) return undefined;
  const limit = getNumberArg(args, "limit");
  if (
    limit === undefined ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_ISSUE_LIST_LIMIT
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `Issue list limit must be a positive integer no greater than ${MAX_ISSUE_LIST_LIMIT}`,
    });
  }
  return limit;
}

function getOptionalStringArg(
  args: ParsedArgs,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export async function issuesCommand(args: ParsedArgs): Promise<void> {
  const subcommand = getId(args, 1);
  const manager = createIssuesManager(cwd());
  const json = getJsonFlag(args);
  const verbose = Boolean(args.verbose || args.v);

  switch (subcommand) {
    case "create": {
      const title = getStringArg(args, "title", "t") || getId(args, 2);
      if (!title) {
        throw INVALID_ARGUMENT.create({
          detail: "Title is required. Usage: veryfront issues create --title 'My issue'",
        });
      }

      const issue = await manager.create({
        title,
        body: getStringArg(args, "body", "b"),
        labels: parseLabels(getStringArg(args, "labels", "l")),
        milestone: getStringArg(args, "milestone", "m"),
        assignees: parseLabels(getStringArg(args, "assignees", "a")),
        prefix: getPrefix(getStringArg(args, "prefix"), "ISSUE")!,
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
      const stateArg = getStringArg(args, "state");
      const result = await manager.list({
        state: stateArg ? parseStateArg(stateArg) : undefined,
        labels: parseLabels(getStringArg(args, "labels", "l")),
        milestone: getStringArg(args, "milestone", "m"),
        assignee: getStringArg(args, "assignee"),
        prefix: getPrefix(getStringArg(args, "prefix")),
        sortBy: getSortField(getStringArg(args, "sort")),
        sortDirection: getSortDirection(getStringArg(args, "dir")),
        limit: getLimit(args),
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
        throw INVALID_ARGUMENT.create({
          detail: "Issue ID is required. Usage: veryfront issues view ISSUE-001",
        });
      }

      const issue = await manager.get(id);
      if (!issue) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Issue not found: ${id}` });
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
        throw INVALID_ARGUMENT.create({
          detail: "Issue ID is required. Usage: veryfront issues edit ISSUE-001 --state closed",
        });
      }

      if (bool(args, "delete", "d")) {
        const deleted = await manager.delete(id);
        if (!deleted) {
          throw RESOURCE_NOT_FOUND.create({ detail: `Issue not found: ${id}` });
        }
        if (json) {
          printJson({ deleted: true, id });
          return;
        }
        cliLogger.info(`Deleted ${id}`);
        return;
      }

      const updates: Parameters<typeof manager.update>[1] = {};

      const title = getOptionalStringArg(args, "title", "t");
      if (title !== undefined) updates.title = title;

      const body = getOptionalStringArg(args, "body", "b");
      if (body !== undefined) updates.body = body;

      const stateArg = getStringArg(args, "state");
      if (stateArg) updates.state = parseStateArg(stateArg);

      const labelsArg = getOptionalStringArg(args, "labels", "l");
      if (labelsArg !== undefined) updates.labels = parseLabels(labelsArg) ?? [];

      const assigneesArg = getOptionalStringArg(args, "assignees", "a");
      if (assigneesArg !== undefined) updates.assignees = parseLabels(assigneesArg) ?? [];

      const milestone = getOptionalStringArg(args, "milestone", "m");
      if (milestone !== undefined) updates.milestone = milestone || null;

      if (!Object.keys(updates).length) {
        throw INVALID_ARGUMENT.create({
          detail: "No updates provided. Use --title, --state, --labels, etc.",
        });
      }

      const issue = await manager.update(id, updates);
      if (!issue) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Issue not found: ${id}` });
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
        throw INVALID_ARGUMENT.create({
          detail: "Issue ID is required. Usage: veryfront issues close ISSUE-001",
        });
      }

      const issue = await manager.close(id);
      if (!issue) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Issue not found: ${id}` });
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
        throw INVALID_ARGUMENT.create({
          detail: "Issue ID is required. Usage: veryfront issues reopen ISSUE-001",
        });
      }

      const issue = await manager.reopen(id);
      if (!issue) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Issue not found: ${id}` });
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
        throw INVALID_ARGUMENT.create({
          detail: "Issue ID is required. Usage: veryfront issues delete ISSUE-001",
        });
      }

      const deleted = await manager.delete(id);
      if (!deleted) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Issue not found: ${id}` });
      }
      if (json) {
        printJson({ deleted: true, id });
        return;
      }
      cliLogger.info(`Deleted ${id}`);
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
  --body, -b <body>        New body content (empty clears)
  --state <state>          New state (open/closed)
  --labels, -l <labels>    Labels to set (empty clears)
  --assignees, -a <users>  Assignees to set (empty clears)
  --milestone, -m <name>   Milestone to set (empty clears)
  --delete, -d             Delete the issue

Global Options:
  --json, -j               Output as JSON
  --verbose                Show more details

Storage:
  issues/*.md              Canonical issue files
  issues/.ids/*            Persistent ID reservation markers; commit these
  issues/.locks/*          Transient per-ID mutation locks

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
