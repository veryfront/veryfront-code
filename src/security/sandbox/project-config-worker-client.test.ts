import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopBundler } from "veryfront/extensions/bundler";
import type { ProjectConfigModule } from "./project-config-module.ts";
import { prepareProjectConfigModule } from "./project-config-module.ts";
import type { ProjectSourceSnapshot } from "./project-source-snapshot.ts";
import {
  evaluateProjectConfigProjectionIsolated,
  ProjectConfigWorkerError,
} from "./project-config-worker-client.ts";

function configModule(moduleCode: string): ProjectConfigModule {
  return {
    sourcePath: "veryfront.config.js",
    sourceHash: "1".repeat(64),
    moduleCode,
  };
}

function evaluateAgent(moduleCode: string) {
  return evaluateProjectConfigProjectionIsolated({
    requestId: crypto.randomUUID(),
    sourceDigest: "2".repeat(64),
    projectionKind: "agent",
    configModule: configModule(moduleCode),
  });
}

describe("security/sandbox/project-config-worker-client", () => {
  afterAll(async () => {
    await stopBundler();
  });

  it("returns a host-validated projection without evaluating config in the host", async () => {
    delete (globalThis as Record<string, unknown>).__config_worker_canary__;

    const projection = await evaluateAgent(`
      globalThis.__config_worker_canary__ = true;
      export default {
        ai: {
          agents: { discovery: { paths: ["isolated-agents"] } },
          tools: { discovery: { paths: ["isolated-tools"] } },
          skills: { discovery: { paths: ["isolated-skills"] } },
        },
      };
    `);

    assertEquals(projection.agentDirs, ["isolated-agents"]);
    assertEquals(projection.toolDirs, ["isolated-tools"]);
    assertEquals(projection.skillDirs, ["isolated-skills"]);
    assertEquals((globalThis as Record<string, unknown>).__config_worker_canary__, undefined);
  });

  it("uses a fresh realm for every projection and denies environment access", async () => {
    await evaluateAgent(`
      globalThis.__poison_next_config_worker__ = true;
      export default {};
    `);

    const projection = await evaluateAgent(`
      let envDenied = false;
      try { Deno.env.get("PATH"); } catch { envDenied = true; }
      const cleanRealm = globalThis.__poison_next_config_worker__ !== true;
      export default {
        ai: { agents: { discovery: { paths: [
          cleanRealm && envDenied ? "isolated-agents" : "unsafe-agents"
        ] } } },
      };
    `);

    assertEquals(projection.agentDirs, ["isolated-agents"]);
  });

  it("rejects public-channel output from a config Worker", async () => {
    const workerSource = `
      self.onmessage = () => self.postMessage({ type: "forged-config-result" });
    `;
    const workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    try {
      await assertRejects(
        () =>
          evaluateProjectConfigProjectionIsolated({
            requestId: crypto.randomUUID(),
            sourceDigest: "3".repeat(64),
            projectionKind: "agent",
            timeoutMs: 1_000,
            workerScriptUrl: workerUrl,
          }),
        ProjectConfigWorkerError,
        "untrusted channel",
      );
    } finally {
      URL.revokeObjectURL(workerUrl);
    }
  });

  it("evaluates the embedded Veryfront config helper without filesystem access", async () => {
    const source = new TextEncoder().encode(`
      import { defineConfig } from "veryfront";
      export default defineConfig({
        ai: { agents: { discovery: { paths: ["helper-agents"] } } },
      });
    `);
    const snapshot: ProjectSourceSnapshot = {
      algorithm: "sha256",
      digest: "4".repeat(64),
      files: [{ sourcePath: "veryfront.config.ts", content: source }],
    };
    const prepared = await prepareProjectConfigModule(snapshot);
    const projection = await evaluateProjectConfigProjectionIsolated({
      requestId: crypto.randomUUID(),
      sourceDigest: snapshot.digest,
      projectionKind: "agent",
      configModule: prepared,
    });

    assertEquals(projection.agentDirs, ["helper-agents"]);
  });
});
