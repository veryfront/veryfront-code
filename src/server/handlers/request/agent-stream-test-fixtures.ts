/** Shared fixtures for agent-stream transport and source-context tests. */
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import type {
  EnvironmentAdapter,
  FileInfo,
  FileSystemAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { FS_ADAPTER_KIND } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "../types.ts";
import { createCtx as createBaseInternalAgentRunContext } from "./internal-agent-run.test-helpers.ts";

export const AGENT_STREAM_TEST_PROJECT_ID = "10000000-1000-4000-8000-100000000005";
export const AGENT_STREAM_TEST_PROJECT_SLUG = "demo-project";

export function createAgentStreamRequestBody(overrides: Record<string, unknown> = {}): string {
  const {
    agentId = "assistant-1",
    threadId = "10000000-1000-4000-8000-100000000001",
    runId = "run_1",
    projectId = AGENT_STREAM_TEST_PROJECT_ID,
    projectSlug = AGENT_STREAM_TEST_PROJECT_SLUG,
    ...invocationOverrides
  } = overrides;

  return JSON.stringify({
    run: {
      agentServiceId: "veryfront-platform-agent",
      agentId,
      conversationId: threadId,
      runId,
      messageId: "10000000-1000-4000-8000-100000000002",
      inputAnchorMessageId: "10000000-1000-4000-8000-100000000003",
      requestedByUserId: "10000000-1000-4000-8000-100000000004",
      project: {
        projectId,
        projectSlug,
        runtimeTargetKind: "main_branch",
      },
    },
    agentSource: { type: "branch", branch: "main" },
    messages: [
      {
        id: "msg_1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ],
    tools: [{ name: "studio_focus_component" }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    ...invocationOverrides,
  });
}

export class TrackingSessionManager extends AgentRunSessionManager {
  readonly stats = {
    cancelCalls: 0,
    completeCalls: 0,
    failCalls: 0,
  };

  override cancelRun(runId: string): boolean {
    this.stats.cancelCalls += 1;
    return super.cancelRun(runId);
  }

  override completeRun(runId: string): void {
    this.stats.completeCalls += 1;
    super.completeRun(runId);
  }

  override failRun(runId: string): void {
    this.stats.failCalls += 1;
    super.failRun(runId);
  }
}

export function createNoopEnvAdapter(publicKeyPem: string): EnvironmentAdapter {
  const values = new Map<string, string>();
  values.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    toObject: () => Object.fromEntries(values),
  };
}

export type SourceContextTestFsAdapter = FileSystemAdapter & {
  readonly [FS_ADAPTER_KIND]: "veryfront-multi-project";
  getUnderlyingAdapter(): FileSystemAdapter;
  isVeryfrontAdapter(): boolean;
  isMultiProjectMode(): boolean;
  runWithContext<R>(
    slug: string,
    token: string,
    fn: () => Promise<R>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<R>;
};

export function createNoopFsAdapter(
  runWithContextCalls: Array<{
    token?: string;
    productionMode?: boolean;
    releaseId?: string | null;
    branch?: string | null;
    environmentName?: string | null;
  }>,
): SourceContextTestFsAdapter {
  const adapter: SourceContextTestFsAdapter = {
    [FS_ADAPTER_KIND]: "veryfront-multi-project",
    readFile: async () => "",
    writeFile: async () => {},
    exists: async () => false,
    async *readDir() {},
    stat: async (): Promise<FileInfo> => ({
      size: 0,
      isFile: false,
      isDirectory: false,
      isSymlink: false,
      mtime: null,
    }),
    mkdir: async () => {},
    remove: async () => {},
    makeTempDir: async () => "/tmp/agent-stream-handler-test",
    watch: () => ({
      close: () => {},
      async *[Symbol.asyncIterator]() {},
    }),
    getUnderlyingAdapter: () => adapter,
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    runWithContext: async (
      projectSlug,
      token,
      fn,
      projectId,
      options,
    ) => {
      runWithContextCalls.push({ token, ...options });
      return await runWithRequestContext(
        { projectSlug, projectId, token, ...options },
        fn,
      );
    },
  };
  return adapter;
}

export function createSourceCapableAgentStreamContext(
  publicKeyPem?: string,
  runWithContextCalls: Parameters<typeof createNoopFsAdapter>[0] = [],
): HandlerContext {
  const context = createBaseInternalAgentRunContext(publicKeyPem);
  return {
    ...context,
    projectId: AGENT_STREAM_TEST_PROJECT_ID,
    projectSlug: AGENT_STREAM_TEST_PROJECT_SLUG,
    adapter: {
      ...context.adapter,
      fs: createNoopFsAdapter(runWithContextCalls),
    },
  };
}
