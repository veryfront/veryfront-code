/**
 * Issue tracking and management. Provides schemas, parsing, serialization,
 * and MCP tools for creating, listing, and updating project issues.
 *
 * @module issues
 */

export type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  IssuePrefix,
  IssueState,
  IssueStorageLimits,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./schemas/index.ts";

export type {
  InferSchema,
  InferShape,
  RefinementCtx,
  Schema,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "#veryfront/extensions/schema/index.ts";
export type { ToolAnnotations } from "#veryfront/mcp/annotations.ts";
export type { MCPTool } from "#veryfront/mcp/types.ts";
export type { FileInfo } from "#veryfront/platform/adapters/base.ts";
export type { FileSystem } from "#veryfront/platform/compat/fs.ts";

export {
  createIssueSchema,
  generateIssueId,
  getCreateIssueSchema,
  getIsoDateSchema,
  getIssueBodySchema,
  getIssueIdSchema,
  getIssueMetadataSchema,
  getIssuePrefixSchema,
  getIssueSchema,
  getIssueStateSchema,
  getLabelSchema,
  getListIssuesResultSchema,
  getListIssuesSchema,
  getUpdateIssueSchema,
  isoDateSchema,
  ISSUE_ID_PATTERN,
  ISSUE_PREFIXES,
  ISSUE_STORAGE_LIMITS,
  issueBodySchema,
  issueIdSchema,
  issueMetadataSchema,
  issuePrefixSchema,
  issueSchema,
  issueStateSchema,
  isValidIssueId,
  labelSchema,
  listIssuesResultSchema,
  listIssuesSchema,
  parseIssueId,
  parseState,
  updateIssueSchema,
  validateMetadata,
} from "./schemas/index.ts";

export {
  createIssuesManager,
  ISSUES_DIR,
  IssuesManager,
  parseFrontmatter,
  parseIssue,
  parseYaml,
  serializeIssue,
  serializeYaml,
} from "./core.ts";

export { createIssuesMcpTools, issuesMcpTools } from "./mcp.ts";
