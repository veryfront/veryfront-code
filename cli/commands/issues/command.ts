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
  parseState,
} from "veryfront/issues";
import { bold, muted, success } from "#cli/ui";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { showCommandHelp } from "../../help/command-help.ts";
import { issuesHelp } from "./command-help.ts";

import type { ParsedArgs } from "#cli/shared/types";
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

function getProvidedStringArg(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function parseIssueState(value: string): IssueState {
  const state = parseState(value);
  if (!state) throw new Error("Issue state must be open, closed, or a supported alias");
  return state;
}

async function printJson(value: unknown): Promise<void> {
  await outputJson(createSuccessEnvelope("issues", value));
}

function getPrefix(prefix: string | undefined, fallback?: IssuePrefix): IssuePrefix | undefined {
  if (prefix === undefined) return fallback;
  const normalized = prefix.toUpperCase();
  const value = ISSUE_PREFIXES.find((candidate) => candidate === normalized);
  if (!value) throw new Error("Issue prefix must be ISSUE, TASK, or PLAN");
  return value;
}

export async function issuesCommand(args: ParsedArgs): Promise<void> {
  const subcommand = getId(args, 1);
  const manager = createIssuesManager(cwd());
  const json = getJsonFlag(args) || isJsonMode();
  const verbose = Boolean(args.verbose || args.v);

  switch (subcommand) {
    case "create": {
      const title = getStringArg(args, "title", "t") || getId(args, 2);
      if (!title) {
        throw new Error("Title is required. Usage: veryfront issues create --title 'My issue'");
      }

      const issue = await manager.create({
        title,
        body: getStringArg(args, "body", "b"),
        labels: parseLabels(getStringArg(args, "labels", "l")),
        milestone: getStringArg(args, "milestone", "m"),
        assignees: parseLabels(getStringArg(args, "assignees", "a")),
        prefix: getPrefix(getProvidedStringArg(args, "prefix"), "ISSUE")!,
      });

      if (json) {
        await printJson(issue);
        return;
      }

      cliLogger.info(`Created ${issue.metadata.id}: ${issue.metadata.title}`);
      cliLogger.info(`  Path: ${issue.path}`);
      return;
    }

    case "list":
    case "ls": {
      const stateArg = getProvidedStringArg(args, "state");
      const result = await manager.list({
        state: stateArg !== undefined ? parseIssueState(stateArg) : undefined,
        labels: parseLabels(getStringArg(args, "labels", "l")),
        milestone: getStringArg(args, "milestone", "m"),
        assignee: getStringArg(args, "assignee"),
        prefix: getPrefix(getProvidedStringArg(args, "prefix")),
        sortBy: (getStringArg(args, "sort") as "created_at" | "updated_at" | "id") ||
          "created_at",
        sortDirection: (getStringArg(args, "dir") as "asc" | "desc") || "desc",
        limit: getNumberArg(args, "limit"),
      });

      if (json) {
        await printJson(result);
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
        throw new Error("Issue ID is required. Usage: veryfront issues view ISSUE-001");
      }

      const issue = await manager.get(id);
      if (!issue) {
        throw new Error(`Issue not found: ${id}`);
      }

      if (json) {
        await printJson(issue);
        return;
      }

      console.log(formatIssueDetails(issue));
      return;
    }

    case "edit":
    case "update": {
      const id = getId(args, 2);
      if (!id) {
        throw new Error(
          "Issue ID is required. Usage: veryfront issues edit ISSUE-001 --state closed",
        );
      }

      if (bool(args, "delete", "d")) {
        const deleted = await manager.delete(id);
        if (!deleted) throw new Error(`Failed to delete ${id}`);
        if (json) {
          await printJson({ deleted: true, id });
          return;
        }
        cliLogger.info(`Deleted ${id}`);
        return;
      }

      const updates: Parameters<typeof manager.update>[1] = {};

      const title = getProvidedStringArg(args, "title", "t");
      if (title !== undefined) updates.title = title;

      const body = getProvidedStringArg(args, "body", "b");
      if (body !== undefined) updates.body = body;

      const stateArg = getProvidedStringArg(args, "state");
      if (stateArg !== undefined) updates.state = parseIssueState(stateArg);

      const labelsArg = getProvidedStringArg(args, "labels", "l");
      if (labelsArg !== undefined) updates.labels = parseLabels(labelsArg) ?? [];

      const assigneesArg = getProvidedStringArg(args, "assignees", "a");
      if (assigneesArg !== undefined) updates.assignees = parseLabels(assigneesArg) ?? [];

      const milestone = getProvidedStringArg(args, "milestone", "m");
      if (milestone !== undefined) updates.milestone = milestone || null;

      if (!Object.keys(updates).length) {
        throw new Error("No updates provided. Use --title, --state, --labels, etc.");
      }

      const issue = await manager.update(id, updates);
      if (!issue) {
        throw new Error(`Issue not found: ${id}`);
      }

      if (json) {
        await printJson(issue);
        return;
      }

      cliLogger.info(`Updated ${issue.metadata.id}`);
      console.log(formatIssue(issue, true));
      return;
    }

    case "close": {
      const id = getId(args, 2);
      if (!id) {
        throw new Error("Issue ID is required. Usage: veryfront issues close ISSUE-001");
      }

      const issue = await manager.close(id);
      if (!issue) {
        throw new Error(`Issue not found: ${id}`);
      }

      if (json) {
        await printJson(issue);
        return;
      }

      cliLogger.info(`Closed ${issue.metadata.id}: ${issue.metadata.title}`);
      return;
    }

    case "reopen": {
      const id = getId(args, 2);
      if (!id) {
        throw new Error("Issue ID is required. Usage: veryfront issues reopen ISSUE-001");
      }

      const issue = await manager.reopen(id);
      if (!issue) {
        throw new Error(`Issue not found: ${id}`);
      }

      if (json) {
        await printJson(issue);
        return;
      }

      cliLogger.info(`Reopened ${issue.metadata.id}: ${issue.metadata.title}`);
      return;
    }

    case "delete":
    case "rm": {
      const id = getId(args, 2);
      if (!id) {
        throw new Error("Issue ID is required. Usage: veryfront issues delete ISSUE-001");
      }

      const deleted = await manager.delete(id);
      if (!deleted) throw new Error(`Issue not found: ${id}`);
      if (json) {
        await printJson({ deleted: true, id });
        return;
      }
      cliLogger.info(`Deleted ${id}`);
      return;
    }

    default: {
      if (json) {
        await printJson(issuesHelp);
        return;
      }
      showCommandHelp("issues");
      return;
    }
  }
}
