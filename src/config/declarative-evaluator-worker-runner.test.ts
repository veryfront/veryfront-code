import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import { evaluatePreparedDeclarativeConfigInWorker } from "./declarative-evaluator-worker-runner.ts";

describe("declarative config runtime worker", () => {
  it("rejects Bun when bounded worker memory limits are unavailable", async () => {
    if (!isBun) return;
    const context = await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment: {},
    });
    const payload = createPreparedDeclarativeConfigWorkerPayload(
      `export default { title: "unreachable" };`,
      context,
      "veryfront.config.ts",
    );

    const error = await assertRejects(() => evaluatePreparedDeclarativeConfigInWorker(payload));

    assertEquals(
      error instanceof Error && "reason" in error
        ? (error as { reason?: unknown }).reason
        : undefined,
      "worker-memory-limit-unavailable",
    );
    assertEquals(
      error instanceof Error ? error.message : undefined,
      "Hosted configuration rejected (evaluator-unavailable: worker-memory-limit-unavailable)",
    );
  });

  it("evaluates a hosted TypeScript config", async () => {
    if (isBun) return;
    const context = await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment: { TENANT: "tenant-value" },
    });
    const payload = createPreparedDeclarativeConfigWorkerPayload(
      `
        import { defineConfigWithEnv, getEnv } from "veryfront";
        export default defineConfigWithEnv((environmentName) => ({
          title: \`\${environmentName}:\${getEnv("TENANT") ?? "missing"}\`,
        }));
      `,
      context,
      "veryfront.config.ts",
    );

    const config = await evaluatePreparedDeclarativeConfigInWorker(payload);

    assertEquals(config.title, "preview:tenant-value");
  });
});
