import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { bindExecutorDiscoveryRoots } from "#veryfront/agent/hosted/executor-discovery-roots.ts";
import { ExecutorDiscoveryError } from "#veryfront/agent/hosted/executor-discovery-schema.ts";

const kinds = [
  "tools",
  "agents",
  "skills",
  "resources",
  "prompts",
  "workflows",
  "tasks",
  "schedules",
  "webhooks",
  "evals",
] as const;

describe("executor discovery root policy", () => {
  it("binds default roots inside the project and preserves the input configuration", async () => {
    const config: VeryfrontConfig = {};
    const before = structuredClone(config);
    const result = await bindExecutorDiscoveryRoots(
      "/bound",
      config,
      (path) => Promise.resolve(path),
    );
    for (const kind of kinds) assertEquals(result.ai[kind]?.discovery?.paths, [kind]);
    assertEquals(result.fs?.type, "local");
    assertEquals(config, before);
  });

  for (const kind of kinds) {
    it(`rejects an outside canonical ${kind} root`, async () => {
      const error = await assertRejects(
        () =>
          bindExecutorDiscoveryRoots(
            "/bound",
            {},
            (path) => Promise.resolve(path === `/bound/${kind}` ? "/outside/source" : path),
          ),
        ExecutorDiscoveryError,
      );
      assert(error instanceof ExecutorDiscoveryError);
      assertEquals(error.code, "CONFIG_INVALID");
    });
  }

  it("uses canonical relative paths for inside aliases and omits missing or disabled roots", async () => {
    const config: VeryfrontConfig = {
      ai: { agents: { discovery: { paths: ["alias"] } }, tools: { discovery: { enabled: false } } },
    };
    const visited: string[] = [];
    const result = await bindExecutorDiscoveryRoots("/bound", config, (path) => {
      visited.push(path);
      if (path === "/bound/alias") return Promise.resolve("/bound/source/agents");
      return Promise.reject(Object.assign(new Error("Missing synthetic root"), { code: "ENOENT" }));
    });
    assertEquals(result.ai.agents?.discovery?.paths, ["source/agents"]);
    assertEquals(result.ai.tools?.discovery?.enabled, false);
    assertEquals(result.ai.tools?.discovery?.paths, []);
    assertEquals(result.ai.skills?.discovery?.paths, []);
    assertEquals(visited.includes("/bound/tools"), false);
  });

  it("does not silently ignore canonicalization failures other than missing roots", async () => {
    await assertRejects(
      () =>
        bindExecutorDiscoveryRoots(
          "/bound",
          {},
          () => Promise.reject(new Error("Synthetic permission failure")),
        ),
      Error,
      "Synthetic permission failure",
    );
  });
});
