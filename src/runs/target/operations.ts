import type { operations, paths } from "../contract/runs-api.generated.ts";

/**
 * Method and path for each Runs target operation, keyed by the contract's operation ID.
 * `client.test.ts` checks every entry against the pinned `paths` at compile time.
 */
export const RUNS_OPERATIONS = {
  listRuns: { method: "GET", path: "/runs" },
  createRun: { method: "POST", path: "/runs" },
  getRun: { method: "GET", path: "/runs/{run_id}" },
  updateRun: { method: "PATCH", path: "/runs/{run_id}" },
  deleteRun: { method: "DELETE", path: "/runs/{run_id}" },
  cancelRun: { method: "POST", path: "/runs/{run_id}/cancel" },
  resumeRun: { method: "POST", path: "/runs/{run_id}/resume" },
  listProjectRuns: { method: "GET", path: "/projects/{project_reference}/runs" },
  listConversationRuns: { method: "GET", path: "/conversations/{conversation_id}/runs" },
  getAccountRunAnalytics: { method: "GET", path: "/account/analytics/runs" },
  listRunEvents: { method: "GET", path: "/runs/{run_id}/events" },
  appendRunEvents: { method: "POST", path: "/runs/{run_id}/events" },
  getRunEvent: { method: "GET", path: "/runs/{run_id}/events/{event_id}" },
  getRunEventsSummary: { method: "GET", path: "/runs/{run_id}/events/summary" },
  getRunSnapshot: { method: "GET", path: "/runs/{run_id}/snapshot" },
  streamRunEvents: { method: "GET", path: "/runs/{run_id}/stream", stream: true },
  listRunEventTypes: { method: "GET", path: "/runs/event-types" },
  listRunInputRequests: { method: "GET", path: "/runs/{run_id}/input-requests" },
  createRunInputRequest: { method: "POST", path: "/runs/{run_id}/input-requests" },
  listConversationInputRequests: {
    method: "GET",
    path: "/conversations/{conversation_id}/input-requests",
  },
  listProjectWebhookRuns: {
    method: "GET",
    path: "/projects/{project_reference}/webhooks/{webhook_definition_id}/runs",
  },
  listEvalRuns: { method: "GET", path: "/projects/{project_reference}/evals/{eval_id}/runs" },
  getInputRequest: { method: "GET", path: "/input-requests/{input_request_id}" },
  createInputResponse: { method: "POST", path: "/input-requests/{input_request_id}/responses" },
  cancelInputRequest: { method: "POST", path: "/input-requests/{input_request_id}/cancel" },
  pauseRun: { method: "POST", path: "/runs/{run_id}/pause" },
  finalizeRun: { method: "POST", path: "/runs/{run_id}/finalize" },
  succeedRun: { method: "POST", path: "/runs/{run_id}/succeed" },
  failRun: { method: "POST", path: "/runs/{run_id}/fail" },
  createRunHeartbeat: { method: "POST", path: "/runs/{run_id}/heartbeats" },
  createRunEventToken: { method: "POST", path: "/runs/{run_id}/event-tokens" },
  listRunChildRuns: { method: "GET", path: "/runs/{run_id}/child-runs" },
  listConversationChildRuns: { method: "GET", path: "/conversations/{conversation_id}/child-runs" },
} as const satisfies Record<keyof operations, RunsOperationRoute>;

/** HTTP route of one Runs operation. */
export interface RunsOperationRoute {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: keyof paths;
  /** The success response is a `text/event-stream`. */
  stream?: true;
}
