import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import { evaluatePreparedDeclarativeConfigInWorker } from "./declarative-evaluator-worker-runner.ts";

describe("declarative config runtime worker", () => {
  it("evaluates a hosted TypeScript config", async () => {
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
