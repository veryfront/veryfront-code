/**
 * MCP (Model Context Protocol) tools for issue tracking
 *
 * Exposes issue operations to AI coding agents like Claude Code and Cursor.
 *
 * @module issues/mcp
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { MCPTool } from "../cli/mcp/tools.ts";
import { createIssuesManager } from "./core.ts";
import type { Issue } from "./types.ts";
import { ISSUE_PREFIXES, parseState } from "./schema.ts";

function getManager(projectDir?: string) {
  return createIssuesManager(projectDir ?? cwd());
}

// ============================================================================
// Tool: issues_create
// ============================================================================

const issuesCreateInput = z.object({
  title: z.string().describe("Issue title"),
  body: z.string().optional().describe("Issue description in markdown"),
  labels: z.array(z.string()).optional().describe(
    "Labels to apply (e.g., ['bug', 'priority:high'])",
  ),
  milestone: z.string().optional().describe("Milestone to assign"),
  assignees: z.array(z.string()).optional().describe("Users to assign"),
  prefix: z.enum(ISSUE_PREFIXES).optional().describe("ID prefix: ISSUE, TASK, or PLAN"),
  projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
});

type IssuesCreateInput = z.infer<typeof issuesCreateInput>;

const issuesCreate: MCPTool<IssuesCreateInput, Issue> = {
  name: "issues_create",
  description: "Create a new issue, task, or plan as a markdown file. " +
    "Use prefix 'TASK' for small work items, 'PLAN' for proposals/RFCs, 'ISSUE' for bugs/features.",
  inputSchema: issuesCreateInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return manager.create({
      title: input.title,
      body: input.body,
      labels: input.labels,
      milestone: input.milestone,
      assignees: input.assignees,
      prefix: input.prefix,
    });
  },
};

// ============================================================================
// Tool: issues_get
// ============================================================================

const issuesGetInput = z.object({
  id: z.string().describe("Issue ID (e.g., ISSUE-001, TASK-042)"),
  projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
});

type IssuesGetInput = z.infer<typeof issuesGetInput>;

const issuesGet: MCPTool<IssuesGetInput, Issue | null> = {
  name: "issues_get",
  description: "Get a specific issue by ID. Returns null if not found.",
  inputSchema: issuesGetInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return manager.get(input.id);
  },
};

// ============================================================================
// Tool: issues_update
// ============================================================================

const issuesUpdateInput = z.object({
  id: z.string().describe("Issue ID to update"),
  title: z.string().optional().describe("New title"),
  body: z.string().optional().describe("New body content"),
  state: z.string().optional().describe("New state: 'open' or 'closed' (aliases: done, resolved)"),
  labels: z.array(z.string()).optional().describe("Labels to set (replaces existing)"),
  milestone: z.string().nullable().optional().describe("Milestone (set to null to remove)"),
  assignees: z.array(z.string()).optional().describe("Assignees to set (replaces existing)"),
  projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
});

type IssuesUpdateInput = z.infer<typeof issuesUpdateInput>;

const issuesUpdate: MCPTool<IssuesUpdateInput, Issue | null> = {
  name: "issues_update",
  description: "Update an existing issue. Only provided fields are updated. " +
    "Returns the updated issue or null if not found.",
  inputSchema: issuesUpdateInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);

    const updates: Parameters<typeof manager.update>[1] = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.body !== undefined) updates.body = input.body;
    if (input.labels !== undefined) updates.labels = input.labels;
    if (input.milestone !== undefined) updates.milestone = input.milestone;
    if (input.assignees !== undefined) updates.assignees = input.assignees;

    if (input.state !== undefined) {
      const state = parseState(input.state);
      if (state) updates.state = state;
    }

    return manager.update(input.id, updates);
  },
};

// ============================================================================
// Tool: issues_list
// ============================================================================

const issuesListInput = z.object({
  state: z.enum(["open", "closed"]).optional().describe("Filter by state"),
  labels: z.array(z.string()).optional().describe("Filter by labels (must have ALL)"),
  milestone: z.string().optional().describe("Filter by milestone"),
  assignee: z.string().optional().describe("Filter by assignee"),
  prefix: z.enum(ISSUE_PREFIXES).optional().describe("Filter by prefix (ISSUE, TASK, PLAN)"),
  sortBy: z.enum(["created_at", "updated_at", "id"]).optional().describe("Sort field"),
  sortDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
  limit: z.number().optional().describe("Maximum results"),
  projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
});

type IssuesListInput = z.infer<typeof issuesListInput>;

interface IssuesListOutput {
  issues: Issue[];
  total: number;
}

const issuesList: MCPTool<IssuesListInput, IssuesListOutput> = {
  name: "issues_list",
  description: "List issues with filtering and sorting. " +
    "Returns matching issues and total count.",
  inputSchema: issuesListInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return manager.list({
      state: input.state,
      labels: input.labels,
      milestone: input.milestone,
      assignee: input.assignee,
      prefix: input.prefix,
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
      limit: input.limit,
    });
  },
};

// ============================================================================
// Tool: issues_close
// ============================================================================

const issuesCloseInput = z.object({
  id: z.string().describe("Issue ID to close"),
  projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
});

type IssuesCloseInput = z.infer<typeof issuesCloseInput>;

const issuesClose: MCPTool<IssuesCloseInput, Issue | null> = {
  name: "issues_close",
  description: "Close an issue. Returns the updated issue or null if not found.",
  inputSchema: issuesCloseInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return manager.close(input.id);
  },
};

// ============================================================================
// Tool: issues_delete
// ============================================================================

const issuesDeleteInput = z.object({
  id: z.string().describe("Issue ID to delete"),
  projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
});

type IssuesDeleteInput = z.infer<typeof issuesDeleteInput>;

interface IssuesDeleteOutput {
  deleted: boolean;
}

const issuesDelete: MCPTool<IssuesDeleteInput, IssuesDeleteOutput> = {
  name: "issues_delete",
  description: "Permanently delete an issue file. " +
    "Use with caution - this cannot be undone.",
  inputSchema: issuesDeleteInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return { deleted: await manager.delete(input.id) };
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All MCP tools for issue tracking
 */
export const issuesMcpTools: MCPTool[] = [
  issuesCreate,
  issuesGet,
  issuesUpdate,
  issuesList,
  issuesClose,
  issuesDelete,
];
