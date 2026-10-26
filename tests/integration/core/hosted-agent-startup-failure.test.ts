import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  startAgentService,
  veryfrontCloudAgentServiceInternals,
} from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import { setApplicationErrorReporter } from "#veryfront/observability/application-errors.ts";
import { __resetLogRecordEmitterForTests } from "#veryfront/utils/logger/logger.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { SandboxShellToolsProviderName } from "#veryfront/extensions/sandbox/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = Deno.makeTempDirSync();
  register(SandboxShellToolsProviderName, () => Promise.resolve({ tools: {} }));
  try {
    await fn(dir);
  } finally {
    await stopEsbuild();
    Deno.removeSync(dir, { recursive: true });
    agentRegistry.clearAll();
    toolRegistryInternal.clearAll();
    unregister(SandboxShellToolsProviderName);
  }
}
function writeMarkdownAgentDefinition(rootDir: string, id: string): void {
  const dir = resolve(rootDir, "agents");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    resolve(dir, `${id}.md`),
    `---
name: Veryfront
model: openai/gpt-5.4
max-steps: 12
---

Help users build with Veryfront.
`,
  );
}

for (const rejectFlush of [false, true]) {
  Deno.test(`selected Deno bind failure captures startup error and resets after flush rejection=${rejectFlush}`, async () => {
    await withTempDir(async (rootDir) => {
      writeMarkdownAgentDefinition(rootDir, "support");
      const occupied = Deno.listen({ hostname: "0.0.0.0", port: 0 });
      const originalVersion = Deno.version;
      Object.defineProperty(Deno, "version", { value: { ...originalVersion, deno: "2.9.7" } });
      const events: string[] = [];
      const captured: unknown[] = [];
      const restore = veryfrontCloudAgentServiceInternals.setInitializeApplicationErrorsForTests(
        () => ({
          enabled: true,
          captureStartupError(error) {
            captured.push(error);
            events.push("capture-startup");
          },
          flush() {
            events.push("flush");
            return rejectFlush
              ? Promise.reject(new Error("synthetic flush failure"))
              : Promise.resolve(true);
          },
          reset() {
            events.push("reset");
          },
        }),
      );
      try {
        await startAgentService({
          serviceName: "agent-selected-bind-failure-test",
          agentId: "support",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          signals: [],
          processTarget: {
            env: {},
            on: () => {},
            off: () => {},
            exit: (code) => {
              events.push(`exit:${code}`);
            },
          },
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "disabled",
            PORT: String(occupied.addr.port),
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        });
        assertEquals(events, ["capture-startup", "flush", "reset", "exit:1"]);
        assertEquals(captured.length, 1);
        const failure = captured[0];
        assert(failure instanceof Error);
        assert(failure.message.includes("Address already in use"));
        assert(failure.cause instanceof Error);
        assertEquals(failure.cause.message, "Address already in use");
      } finally {
        restore();
        Object.defineProperty(Deno, "version", { value: originalVersion });
        occupied.close();
        __resetLogRecordEmitterForTests();
        setApplicationErrorReporter(undefined);
      }
    });
  });
}
