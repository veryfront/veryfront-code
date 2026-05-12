/**
 * MCP (Model Context Protocol) tools for issue tracking
 *
 * Exposes issue operations to AI coding agents like Claude Code and Cursor.
 *
 * @module issues/mcp
 */

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { MCPTool } from "#veryfront/mcp/types.ts";
import { createIssuesManager } from "./core.ts";
import type { Issue } from "./schemas/index.ts";
import {
  getCreateIssueSchema,
  getIssueIdSchema,
  getIssuePrefixSchema,
  getIssueStateSchema,
  getLabelSchema,
  getListIssuesSchema,
  getUpdateIssueSchema,
  parseState,
} from "./schemas/index.ts";

function getManager(projectDir?: string) {
  return createIssuesManager(projectDir ?? cwd());
}

// ============================================================================
// Shared schema extension for projectDir
// ============================================================================

const getProjectDirSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().optional().describe("Project directory (defaults to cwd)"),
  })
);

// ============================================================================
// Tool: issues_create
// ============================================================================

const getIssuesCreateInput = defineSchema((v) =>
  getCreateIssueSchema().extend({
    title: v.string().describe("Issue title"),
    body: v.string().optional().describe("Issue description in markdown"),
    labels: v.array(getLabelSchema()).optional().describe(
      "Labels to apply (e.g., ['bug', 'priority:high'])",
    ),
    milestone: v.string().optional().describe("Milestone to assign"),
    assignees: v.array(v.string()).optional().describe("Users to assign"),
    prefix: getIssuePrefixSchema().optional().describe("ID prefix: ISSUE, TASK, or PLAN"),
  }).merge(getProjectDirSchema())
);
const issuesCreateInput = getIssuesCreateInput();

type IssuesCreateInput = InferSchema<ReturnType<typeof getIssuesCreateInput>>;

const issuesCreate: MCPTool<IssuesCreateInput, Issue> = {
  name: "issues_create",
  title: "Create Issue",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description: "Use this when you need to create a new issue, task, or plan as a markdown file. " +
    "Use prefix 'TASK' for small work items, 'PLAN' for proposals/RFCs, 'ISSUE' for bugs/features. " +
    "Returns the created issue. Do not use for updating — use issues_update instead.",
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

const getIssuesGetInput = defineSchema((_v) =>
  getProjectDirSchema().extend({
    id: getIssueIdSchema().describe("Issue ID (e.g., ISSUE-001, TASK-042)"),
  })
);
const issuesGetInput = getIssuesGetInput();

type IssuesGetInput = InferSchema<ReturnType<typeof getIssuesGetInput>>;

const issuesGet: MCPTool<IssuesGetInput, Issue | null> = {
  name: "issues_get",
  title: "Get Issue",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to retrieve a specific issue by its ID. Returns the issue or null if not found. Do not use for listing — use issues_list instead.",
  inputSchema: issuesGetInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return manager.get(input.id);
  },
};

// ============================================================================
// Tool: issues_update
// ============================================================================

const getIssuesUpdateInput = defineSchema((v) =>
  getUpdateIssueSchema().extend({
    id: getIssueIdSchema().describe("Issue ID to update"),
    title: v.string().optional().describe("New title"),
    body: v.string().optional().describe("New body content"),
    state: v.string().optional().describe(
      "New state: 'open' or 'closed' (aliases: done, resolved)",
    ),
    labels: v.array(getLabelSchema()).optional().describe("Labels to set (replaces existing)"),
    milestone: v.string().nullable().optional().describe("Milestone (set to null to remove)"),
    assignees: v.array(v.string()).optional().describe("Assignees to set (replaces existing)"),
  }).merge(getProjectDirSchema())
);
const issuesUpdateInput = getIssuesUpdateInput();

type IssuesUpdateInput = InferSchema<ReturnType<typeof getIssuesUpdateInput>>;

const issuesUpdate: MCPTool<IssuesUpdateInput, Issue | null> = {
  name: "issues_update",
  title: "Update Issue",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to modify an existing issue. Only provided fields are updated. " +
    "Returns the updated issue or null if not found. Do not use to close — use issues_close instead.",
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

const getIssuesListInput = defineSchema((v) =>
  getListIssuesSchema().extend({
    state: getIssueStateSchema().optional().describe("Filter by state"),
    labels: v.array(getLabelSchema()).optional().describe("Filter by labels (must have ALL)"),
    milestone: v.string().optional().describe("Filter by milestone"),
    assignee: v.string().optional().describe("Filter by assignee"),
    prefix: getIssuePrefixSchema().optional().describe("Filter by prefix (ISSUE, TASK, PLAN)"),
    sortBy: v.enum(["created_at", "updated_at", "id"]).optional().describe("Sort field"),
    sortDirection: v.enum(["asc", "desc"]).optional().describe("Sort direction"),
    limit: v.number().optional().describe("Maximum results"),
  }).merge(getProjectDirSchema())
);
const issuesListInput = getIssuesListInput();

type IssuesListInput = InferSchema<ReturnType<typeof getIssuesListInput>>;

interface IssuesListOutput {
  issues: Issue[];
  total: number;
}

const issuesList: MCPTool<IssuesListInput, IssuesListOutput> = {
  name: "issues_list",
  title: "List Issues",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description: "Use this when you need to find issues matching criteria. " +
    "Returns matching issues and total count. Do not use to get a single known issue — use issues_get instead.",
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

const getIssuesCloseInput = defineSchema((_v) =>
  getProjectDirSchema().extend({
    id: getIssueIdSchema().describe("Issue ID to close"),
  })
);
const issuesCloseInput = getIssuesCloseInput();

type IssuesCloseInput = InferSchema<ReturnType<typeof getIssuesCloseInput>>;

const issuesClose: MCPTool<IssuesCloseInput, Issue | null> = {
  name: "issues_close",
  title: "Close Issue",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to close an issue. Returns the updated issue or null if not found. Do not use to delete — use issues_delete instead.",
  inputSchema: issuesCloseInput,
  execute: async (input) => {
    const manager = getManager(input.projectDir);
    return manager.close(input.id);
  },
};

// ============================================================================
// Tool: issues_delete
// ============================================================================

const getIssuesDeleteInput = defineSchema((_v) =>
  getProjectDirSchema().extend({
    id: getIssueIdSchema().describe("Issue ID to delete"),
  })
);
const issuesDeleteInput = getIssuesDeleteInput();

type IssuesDeleteInput = InferSchema<ReturnType<typeof getIssuesDeleteInput>>;

interface IssuesDeleteOutput {
  deleted: boolean;
}

const issuesDelete: MCPTool<IssuesDeleteInput, IssuesDeleteOutput> = {
  name: "issues_delete",
  title: "Delete Issue",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to permanently delete an issue. Returns {deleted: true/false}. " +
    "WARNING: this is irreversible and cannot be undone. Prefer issues_close unless permanent deletion is explicitly requested. " +
    "Do not use to close — use issues_close instead.",
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
