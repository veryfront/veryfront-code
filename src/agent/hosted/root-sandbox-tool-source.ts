import {
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxTools,
} from "#veryfront/sandbox";
import type { HostToolSet } from "#veryfront/tool";
import type { DefaultHostedChatRuntimeTaskContext } from "./default-chat-runtime.ts";

const HOSTED_ROOT_SANDBOX_TOOL_NAMES = new Set([
  "bash",
  "sandbox_read_file",
  "sandbox_write_file",
  "start_background_command",
  "get_background_command",
  "get_background_command_output",
  "cancel_background_command",
]);

type CreateAgentServiceSandboxTools = (
  input: AgentServiceSandboxToolsOptions,
) => Promise<Pick<AgentServiceSandboxToolsResult, "tools" | "closeSandbox">>;

/** Input used to prepare the hosted root sandbox tool source. */
export type PrepareHostedRootSandboxToolSourceInput = AgentServiceSandboxToolsOptions & {
  allowedToolNames: readonly string[] | undefined;
  createAgentServiceSandboxTools?: CreateAgentServiceSandboxTools;
};

/** Tool source and cleanup returned for a hosted root sandbox. */
export type HostedRootSandboxToolSource = {
  tools: HostToolSet;
  closeRuntime?: () => Promise<void>;
};

/** Input used to create the hosted root local tool lifecycle. */
export type CreateHostedRootLocalToolRuntimeInput =
  & Omit<
    PrepareHostedRootSandboxToolSourceInput,
    "getProjectId"
  >
  & {
    buildBaseTools: (taskContext: DefaultHostedChatRuntimeTaskContext) => HostToolSet;
  };

/** Hosted root local tool builder and runtime cleanup. */
export type HostedRootLocalToolRuntime = {
  buildLocalTools: (taskContext: DefaultHostedChatRuntimeTaskContext) => Promise<HostToolSet>;
  cleanup: () => Promise<void>;
};

/** Prepare sandbox tools only when the effective root selection includes a sandbox tool. */
export async function prepareHostedRootSandboxToolSource(
  input: PrepareHostedRootSandboxToolSourceInput,
): Promise<HostedRootSandboxToolSource> {
  const {
    allowedToolNames,
    createAgentServiceSandboxTools: createSandboxToolsOverride,
    ...sandboxInput
  } = input;
  if (
    allowedToolNames !== undefined &&
    !allowedToolNames.some((toolName) => HOSTED_ROOT_SANDBOX_TOOL_NAMES.has(toolName))
  ) {
    return { tools: {} };
  }

  const createSandboxTools = createSandboxToolsOverride ?? createAgentServiceSandboxTools;
  const sandboxResult = await createSandboxTools(sandboxInput);
  return {
    tools: sandboxResult.tools,
    closeRuntime: sandboxResult.closeSandbox,
  };
}

/** Create the hosted root local tool builder with sandbox lifecycle ownership. */
export function createHostedRootLocalToolRuntime(
  input: CreateHostedRootLocalToolRuntimeInput,
): HostedRootLocalToolRuntime {
  let closeRuntime: (() => Promise<void>) | undefined;
  let localToolsPromise: Promise<HostToolSet> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const { buildBaseTools, ...sandboxInput } = input;

  return {
    buildLocalTools(taskContext) {
      localToolsPromise ??= (async () => {
        const baseTools = buildBaseTools(taskContext);
        const sandboxSource = await prepareHostedRootSandboxToolSource({
          ...sandboxInput,
          getProjectId: () => taskContext.projectId,
        });
        closeRuntime = sandboxSource.closeRuntime;
        return {
          ...baseTools,
          ...sandboxSource.tools,
        };
      })();
      return localToolsPromise;
    },
    cleanup() {
      cleanupPromise ??= (async () => {
        try {
          await localToolsPromise;
        } catch {
          // Setup errors remain owned by the caller; cleanup only releases any
          // handle that setup managed to establish before failing.
        }
        await closeRuntime?.();
      })();
      return cleanupPromise;
    },
  };
}
