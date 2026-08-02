import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { join } from "node:path";
import { createStrictHostedAgentProjectSteering } from "./agent-project-steering.ts";
import {
  createNodeVeryfrontCloudAgentServiceContext,
  getProjectSteering,
} from "./cloud-agent-config.ts";
import { fetchProjectSteering } from "./cloud-agent-child-tools.ts";

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

Deno.test("cloud project steering propagates one caller cancellation through cached strict composition", async () => {
  const rootDir = await Deno.makeTempDir();
  const skillsDir = join(rootDir, "skills");
  await Deno.mkdir(skillsDir);

  try {
    const context = createNodeVeryfrontCloudAgentServiceContext({
      serviceName: "cloud-project-steering-test",
      agentId: "support",
      baseDir: rootDir,
      projectDir: rootDir,
      createBashTool,
      env: {
        VERYFRONT_API_URL: "https://api.example.test",
      },
    });
    context.defaultAgentId = "support";

    const caller = new AbortController();
    const cancellation = new DOMException("cloud request disconnected", "AbortError");
    const observedSignals: AbortSignal[] = [];
    let notifyBothFetchesStarted!: () => void;
    const bothFetchesStarted = new Promise<void>((resolve) => {
      notifyBothFetchesStarted = resolve;
    });
    const steering = createStrictHostedAgentProjectSteering({
      baseDir: rootDir,
      agentId: "support",
      skillsDir,
      getApiUrl: () => "https://api.example.test",
      fetch: (_url, init) => {
        observedSignals.push(init.signal as AbortSignal);
        if (observedSignals.length === 2) {
          notifyBothFetchesStarted();
        }
        return new Promise(() => undefined);
      },
    });
    context.projectSteeringByAgentId.set("support", steering);

    const result = fetchProjectSteering(
      context,
      {
        projectId: "project-1",
        authToken: "token-1",
      },
      undefined,
      caller.signal,
    );
    await bothFetchesStarted;
    caller.abort(cancellation);
    const error = await assertRejects(() => result);

    assertEquals(error, cancellation);
    assertEquals(getProjectSteering(context), steering);
    assertEquals(observedSignals.length, 2);
    for (const signal of observedSignals) {
      assertEquals(signal.aborted, true);
      assertEquals(signal.reason, cancellation);
    }
  } finally {
    await Deno.remove(rootDir, { recursive: true });
  }
});
