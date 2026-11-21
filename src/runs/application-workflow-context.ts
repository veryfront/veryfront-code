import type { BoundedRetryConfig } from "#veryfront/utils/config-resource-limits.ts";
import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import type { CreateWorkflowRunInput } from "./runs-client.ts";
import type { RunsCallOptions, RunsOutput } from "./target/client.ts";

export type ApplicationWorkflowRun = RunsOutput<"getRun">;
export interface ApplicationWorkflowRuns {
  owns(runId: string): boolean;
  start(input: CreateWorkflowRunInput, retry: BoundedRetryConfig): Promise<ApplicationWorkflowRun>;
  read(
    runId: string,
    retry: BoundedRetryConfig,
    options?: RunsCallOptions,
  ): Promise<ApplicationWorkflowRun>;
  cancel(runId: string, retry: BoundedRetryConfig): Promise<ApplicationWorkflowRun>;
}

const scopes = createPrivateAsyncLocalStorage<ApplicationWorkflowRuns>();
export function currentApplicationWorkflowRuns(): ApplicationWorkflowRuns | undefined {
  return scopes.getStore();
}

export function withApplicationWorkflowRuns<T>(
  runs: ApplicationWorkflowRuns,
  action: () => Promise<T>,
): Promise<T> {
  return scopes.run(runs, action);
}
