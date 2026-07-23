import type { SubmitToolResultOutcome } from "./session-manager.ts";

export interface AgentRunControlBinding {
  projectId: string;
  projectSlug: string;
}

export type AgentRunOwnership = "owned" | "binding-mismatch" | "absent";

export class AgentRunControlBindingError extends Error {
  constructor() {
    super("Agent run does not belong to the signed project");
    this.name = "AgentRunControlBindingError";
  }
}

export interface AgentRunControl {
  submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
    binding?: AgentRunControlBinding,
  ): SubmitToolResultOutcome | Promise<SubmitToolResultOutcome>;
  cancelRun(
    runId: string,
    binding?: AgentRunControlBinding,
  ): boolean | Promise<boolean>;
}

export interface OwnedAgentRunControl extends AgentRunControl {
  getRunOwnership(runId: string, binding?: AgentRunControlBinding): AgentRunOwnership;
}

export class AgentRunControlRouter implements AgentRunControl {
  constructor(
    private readonly isolatedRuns: OwnedAgentRunControl,
    private readonly fallback: AgentRunControl,
  ) {}

  async submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
    binding?: AgentRunControlBinding,
  ): Promise<SubmitToolResultOutcome> {
    const ownership = this.isolatedRuns.getRunOwnership(runId, binding);
    if (ownership === "binding-mismatch") throw new AgentRunControlBindingError();
    if (ownership === "owned") {
      return await this.isolatedRuns.submitToolResult(runId, input, binding);
    }
    return await this.fallback.submitToolResult(runId, input, binding);
  }

  async cancelRun(
    runId: string,
    binding?: AgentRunControlBinding,
  ): Promise<boolean> {
    const ownership = this.isolatedRuns.getRunOwnership(runId, binding);
    if (ownership === "binding-mismatch") throw new AgentRunControlBindingError();
    if (ownership === "owned") {
      return await this.isolatedRuns.cancelRun(runId, binding);
    }
    return await this.fallback.cancelRun(runId, binding);
  }
}
