/**
 * CI/CD MCP tools — placeholder
 *
 * These tools require backend API support that is not yet available.
 * They were previously registered as stubs returning "not_implemented",
 * which misled agents into wasting tool calls.
 *
 * Re-add tools here when the deploy API is available:
 * - vf_get_pipeline_status
 * - vf_get_deploy_history
 * - vf_get_build_logs
 * - vf_trigger_deploy
 */

import type { MCPTool } from "veryfront/mcp";

export const cicdTools: MCPTool[] = [];
