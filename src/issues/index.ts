/**
 * File-based issue tracking module
 *
 * @module issues
 */

// Types
export type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  IssueState,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./types.ts";

// Schema and validation
export {
  createIssueSchema,
  generateIssueId,
  ISSUE_ID_PATTERN,
  ISSUE_PREFIXES,
  issueIdSchema,
  issueMetadataSchema,
  issueStateSchema,
  isValidIssueId,
  listIssuesSchema,
  parseIssueId,
  parseState,
  updateIssueSchema,
  validateMetadata,
} from "./schema.ts";
export type { IssuePrefix } from "./schema.ts";

// Core CRUD
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

// MCP tools
export { issuesMcpTools } from "./mcp.ts";
