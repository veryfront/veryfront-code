/**
 * MCP (Model Context Protocol) tools for issue tracking
 *
 * Exposes issue operations to AI coding agents like Claude Code and Cursor.
 *
 * @module issues/mcp
 */

import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { MCPTool } from "#veryfront/mcp/types.ts";
import { createIssuesManager } from "./core.ts";
import type { Issue } from "./schemas/index.ts";
import {
  getCreateIssueSchema,
  getIssueIdSchema,
  getListIssuesSchema,
  getUpdateIssueSchema,
  parseState,
} from "./schemas/index.ts";

const MAX_STATE_ALIAS_LENGTH = 32;
type IssuesManager = ReturnType<typeof createIssuesManager>;

function freezeTool<TInput, TOutput>(tool: MCPTool<TInput, TOutput>): MCPTool<TInput, TOutput> {
  if (tool.annotations) Object.freeze(tool.annotations);
  return Object.freeze(tool);
}

// ============================================================================
// Tool: issues_create
// ============================================================================

const getIssuesCreateInput = defineSchema((_v) => getCreateIssueSchema());
const issuesCreateInput = lazySchema(getIssuesCreateInput);

type IssuesCreateInput = InferSchema<ReturnType<typeof getIssuesCreateInput>>;

function createIssuesCreateTool(
  manager: IssuesManager,
): MCPTool<IssuesCreateInput, Issue> {
  return {
    name: "issues_create",
    title: "Create issue",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description:
      "Creates a Markdown-backed project issue and returns it. Select ISSUE, TASK, or PLAN as the identifier prefix. Use issues_update to change an existing issue.",
    inputSchema: issuesCreateInput,
    execute: async (input) => {
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
}

// ============================================================================
// Tool: issues_get
// ============================================================================

const getIssuesGetInput = defineSchema((_v) =>
  _v.object({
    id: getIssueIdSchema().describe("Issue ID, for example ISSUE-001 or TASK-042"),
  }).strict()
);
const issuesGetInput = lazySchema(getIssuesGetInput);

type IssuesGetInput = InferSchema<ReturnType<typeof getIssuesGetInput>>;

function createIssuesGetTool(
  manager: IssuesManager,
): MCPTool<IssuesGetInput, Issue | null> {
  return {
    name: "issues_get",
    title: "Get issue",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    description:
      "Returns a project issue by ID, or null when it does not exist. Use issues_list to query multiple issues.",
    inputSchema: issuesGetInput,
    execute: async (input) => manager.get(input.id),
  };
}

// ============================================================================
// Tool: issues_update
// ============================================================================

const getMcpIssueStateSchema = defineSchema((v) =>
  v.string().min(1).max(MAX_STATE_ALIAS_LENGTH).refine(
    (value) => parseState(value) !== null,
    "Issue state must be open, closed, or a supported alias",
  )
);

const getIssuesUpdateInput = defineSchema((_v) =>
  getUpdateIssueSchema().omit({ state: true }).extend({
    id: getIssueIdSchema().describe("Issue ID to update"),
    state: getMcpIssueStateSchema().optional().describe(
      "New state: 'open' or 'closed' (aliases: done, resolved)",
    ),
  }).strict()
);
const issuesUpdateInput = lazySchema(getIssuesUpdateInput);

type IssuesUpdateInput = InferSchema<ReturnType<typeof getIssuesUpdateInput>>;

function createIssuesUpdateTool(
  manager: IssuesManager,
): MCPTool<IssuesUpdateInput, Issue | null> {
  return {
    name: "issues_update",
    title: "Update issue",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Updates the provided fields on a project issue. Returns the updated issue, or null when it does not exist. Use issues_close when only the state must change to closed.",
    inputSchema: issuesUpdateInput,
    execute: async (input) => {
      const updates: Parameters<typeof manager.update>[1] = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.body !== undefined) updates.body = input.body;
      if (input.labels !== undefined) updates.labels = input.labels;
      if (input.milestone !== undefined) updates.milestone = input.milestone;
      if (input.assignees !== undefined) updates.assignees = input.assignees;

      if (input.state !== undefined) {
        const state = parseState(input.state);
        if (!state) throw new TypeError("Issue state must be open, closed, or a supported alias");
        updates.state = state;
      }

      return manager.update(input.id, updates);
    },
  };
}

// ============================================================================
// Tool: issues_list
// ============================================================================

const getIssuesListInput = defineSchema((_v) => getListIssuesSchema());
const issuesListInput = lazySchema(getIssuesListInput);

type IssuesListInput = InferSchema<ReturnType<typeof getIssuesListInput>>;

interface IssuesListOutput {
  issues: Issue[];
  total: number;
}

function createIssuesListTool(
  manager: IssuesManager,
): MCPTool<IssuesListInput, IssuesListOutput> {
  return {
    name: "issues_list",
    title: "List issues",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    description:
      "Returns project issues that match the provided filters, plus the total match count. Use issues_get when you know the issue ID.",
    inputSchema: issuesListInput,
    execute: async (input) => {
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
}

// ============================================================================
// Tool: issues_close
// ============================================================================

const getIssuesCloseInput = defineSchema((_v) =>
  _v.object({
    id: getIssueIdSchema().describe("Issue ID to close"),
  }).strict()
);
const issuesCloseInput = lazySchema(getIssuesCloseInput);

type IssuesCloseInput = InferSchema<ReturnType<typeof getIssuesCloseInput>>;

function createIssuesCloseTool(
  manager: IssuesManager,
): MCPTool<IssuesCloseInput, Issue | null> {
  return {
    name: "issues_close",
    title: "Close issue",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Closes a project issue and returns the updated issue, or null when it does not exist. Use issues_delete only for permanent removal.",
    inputSchema: issuesCloseInput,
    execute: async (input) => manager.close(input.id),
  };
}

// ============================================================================
// Tool: issues_delete
// ============================================================================

const getIssuesDeleteInput = defineSchema((_v) =>
  _v.object({
    id: getIssueIdSchema().describe("Issue ID to delete"),
  }).strict()
);
const issuesDeleteInput = lazySchema(getIssuesDeleteInput);

type IssuesDeleteInput = InferSchema<ReturnType<typeof getIssuesDeleteInput>>;

interface IssuesDeleteOutput {
  deleted: boolean;
}

function createIssuesDeleteTool(
  manager: IssuesManager,
): MCPTool<IssuesDeleteInput, IssuesDeleteOutput> {
  return {
    name: "issues_delete",
    title: "Delete issue",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Permanently deletes a project issue and returns whether a file was removed. This action cannot be undone. Use issues_close when the issue must remain available.",
    inputSchema: issuesDeleteInput,
    execute: async (input) => ({ deleted: await manager.delete(input.id) }),
  };
}

// ============================================================================
// Tool Registry
// ============================================================================

/** Create issue tools bound to a trusted project root. */
export function createIssuesMcpTools(projectDir: string): readonly MCPTool[] {
  const manager = createIssuesManager(projectDir);
  return Object.freeze([
    freezeTool(createIssuesCreateTool(manager)),
    freezeTool(createIssuesGetTool(manager)),
    freezeTool(createIssuesUpdateTool(manager)),
    freezeTool(createIssuesListTool(manager)),
    freezeTool(createIssuesCloseTool(manager)),
    freezeTool(createIssuesDeleteTool(manager)),
  ]);
}

/** MCP tools bound to the process working directory at module initialization. */
export const issuesMcpTools: readonly MCPTool[] = createIssuesMcpTools(cwd());
