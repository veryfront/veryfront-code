/**
 * Issues
 *
 * @module issues
 */

export type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  IssuePrefix,
  IssueState,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./schemas/index.ts";

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

export { issuesMcpTools } from "./mcp.ts";
