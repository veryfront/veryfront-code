import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import type {
  EnvironmentAdapter,
  FileInfo,
  FileSystemAdapter,
} from "#veryfront/platform/adapters/base.ts";

export function createAgentStreamRequestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agentId: "assistant-1",
    threadId: "10000000-1000-4000-8000-100000000001",
    runId: "run_1",
    messages: [
      {
        id: "msg_1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ],
    tools: [{ name: "studio_focus_component" }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    ...overrides,
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
    productionMode?: boolean;
    releaseId?: string | null;
    branch?: string | null;
    environmentName?: string | null;
  }>,
): SourceContextTestFsAdapter {
  return {
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
    isMultiProjectMode: () => true,
    runWithContext: async (
      _projectSlug,
      _token,
      fn,
      _projectId,
      options,
    ) => {
      runWithContextCalls.push(options ?? {});
      return await fn();
    },
  };
}
