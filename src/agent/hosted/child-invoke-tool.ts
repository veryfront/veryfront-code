import { tool } from "#veryfront/tool";
import type { Tool, ToolConfig, ToolExecutionContext } from "#veryfront/tool";
import {
  buildInvokeAgentFollowupInstruction,
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE,
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY,
  isStarterIntentRootOwnershipRequired,
} from "../conversation/delegation-policy.ts";
import { buildHostedChildToolDescription } from "./child-requested-tools.ts";
import { shouldBlockHostedChildSameTurnRetry } from "./child-status.ts";

/** Public API contract for hosted child invoke failure. */
export interface HostedChildInvokeFailure {
  terminalErrorCode: string;
  terminalErrorMessage: string;
}

/** Options accepted by create hosted child invoke tool. */
export interface CreateHostedChildInvokeToolOptions<TInput, TResult> {
  id?: string;
  inputSchema: ToolConfig<TInput, TResult>["inputSchema"];
  additionalDescriptionParts?: readonly string[];
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TResult> | TResult;
  buildFailureResult: (failure: HostedChildInvokeFailure) => TResult;
  decorateResult?: (result: TResult) => TResult;
  shouldBlockSameTurnRetry?: (result: TResult) => boolean;
  retryBlockedErrorCode?: string;
  retryBlockedMessage?: string;
  starterIntentRootOwnershipErrorCode?: string;
  starterIntentRootOwnershipMessage?: string;
}

const DEFAULT_RETRY_BLOCKED_ERROR_CODE = "INVOKE_AGENT_RETRY_BLOCKED";
const DEFAULT_STARTER_INTENT_ROOT_OWNERSHIP_ERROR_CODE = "STARTER_INTENT_ROOT_OWNERSHIP_REQUIRED";
const DEFAULT_RETRY_BLOCKED_MESSAGE =
  "A delegated child run was cancelled in this response. Start a fresh turn instead of retrying invoke_agent again in the same run.";

function shouldBlockForStarterIntentRootOwnership(context?: ToolExecutionContext): boolean {
  return isStarterIntentRootOwnershipRequired(
    context?.[FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY],
  );
}

function buildHostedChildInvokeToolDescription(
  additionalDescriptionParts?: readonly string[],
): string {
  return [
    buildHostedChildToolDescription(),
    buildInvokeAgentFollowupInstruction(),
    ...(additionalDescriptionParts ?? []),
  ].join("\n\n");
}

/** Create hosted child invoke tool. */
export function createHostedChildInvokeTool<TInput, TResult>(
  options: CreateHostedChildInvokeToolOptions<TInput, TResult>,
): Tool<TInput, TResult> {
  let blockedRetryMessage: string | null = null;

  return tool({
    ...(options.id ? { id: options.id } : {}),
    description: buildHostedChildInvokeToolDescription(options.additionalDescriptionParts),
    inputSchema: options.inputSchema,
    execute: async (input, executionOptions) => {
      if (blockedRetryMessage) {
        return options.buildFailureResult({
          terminalErrorCode: options.retryBlockedErrorCode ?? DEFAULT_RETRY_BLOCKED_ERROR_CODE,
          terminalErrorMessage: blockedRetryMessage,
        });
      }

      if (shouldBlockForStarterIntentRootOwnership(executionOptions)) {
        return options.buildFailureResult({
          terminalErrorCode: options.starterIntentRootOwnershipErrorCode ??
            DEFAULT_STARTER_INTENT_ROOT_OWNERSHIP_ERROR_CODE,
          terminalErrorMessage: options.starterIntentRootOwnershipMessage ??
            FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE,
        });
      }

      const rawResult = await options.execute(input, executionOptions);
      const result = options.decorateResult ? options.decorateResult(rawResult) : rawResult;
      const shouldBlockRetry = options.shouldBlockSameTurnRetry ??
        shouldBlockHostedChildSameTurnRetry;

      if (shouldBlockRetry(result)) {
        blockedRetryMessage = options.retryBlockedMessage ?? DEFAULT_RETRY_BLOCKED_MESSAGE;
      }

      return result;
    },
  });
}
