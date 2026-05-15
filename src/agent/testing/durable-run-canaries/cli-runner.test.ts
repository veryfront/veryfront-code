import { join } from "node:path";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runDurableRunCanaryCli } from "./cli-runner.ts";
import type { DurableRunCanaryCase } from "./runner.ts";
import type { createDurableRunCanaryRunner } from "./runner.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";

describe("agent testing durable run canary CLI runner", () => {
  it("runs canary cases, writes a report, and returns success", async () => {
    const cwd = await Deno.makeTempDir();
    const reportPath = join(cwd, "durable-report.json");
    const logs: string[] = [];
    const testCase: DurableRunCanaryCase = {
      id: "canary-a",
      label: "Canary A",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "hello",
        title: "Canary A",
        validate: () => {},
      }),
    };
    const runner: ReturnType<typeof createDurableRunCanaryRunner> = {
      runCase: async (currentCase) => ({
        id: currentCase.id,
        label: currentCase.label,
        status: "pass",
        details: "OK",
        durationMs: 10,
        conversationId,
        runId: "run_1",
      }),
    };

    const exitCode = await runDurableRunCanaryCli({
      cwd,
      agentId: "veryfront",
      env: {
        VERYFRONT_TOKEN: "token",
        AG_UI_EVAL_PROJECT_ID: "project-1",
        DURABLE_CANARY_REPORT_PATH: reportPath,
      },
      createCases: () => [testCase],
      createRunner: () => runner,
      log: (message) => logs.push(message),
    });

    assertEquals(exitCode, 0);
    assertEquals(logs.some((entry) => entry.includes("[pass] canary-a: OK")), true);
    const report = await Deno.readTextFile(reportPath);
    assertStringIncludes(report, '"canary-a"');
    assertStringIncludes(report, '"passed": 1');
  });
});
