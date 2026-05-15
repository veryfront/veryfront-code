import { join } from "node:path";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runLiveEvalCli } from "./cli-runner.ts";
import type { LiveEvalCase } from "./runner.ts";
import type { createLiveEvalCaseSupport } from "./runner.ts";

const reportPath = "live-report.json";

describe("agent testing live eval CLI runner", () => {
  it("runs selected cases, writes a report, and returns success", async () => {
    const cwd = await Deno.makeTempDir();
    const logs: string[] = [];
    const readOnlyCase: LiveEvalCase = {
      id: "case-a",
      label: "Case A",
      metadata: { tags: ["gate:ci"] },
      verify: () => null,
    };
    const skippedWriteCase: LiveEvalCase = {
      id: "case-b",
      label: "Case B",
      metadata: { tags: ["gate:nightly"] },
      verify: () => null,
    };
    const caseSupport: ReturnType<typeof createLiveEvalCaseSupport> = {
      judgeLlm: async () => ({ pass: true, reason: "PASS" }),
      runEval: async (testCase, runtime) => ({
        id: testCase.id,
        label: testCase.label,
        runtime,
        status: "pass",
        details: "OK",
        durationMs: 10,
      }),
      verifyFileExists: async () => null,
      withJudge: () => async () => null,
    };

    const exitCode = await runLiveEvalCli({
      cwd,
      env: {
        VERYFRONT_TOKEN: "token",
        AG_UI_EVAL_PROJECT_ID: "project-1",
        AG_UI_EVAL_REPORT_PATH: join(cwd, reportPath),
        AG_UI_EVAL_TAGS: "gate:ci",
        AG_UI_EVAL_WRITE: "1",
      },
      caseSets: {},
      createCaseSupport: () => caseSupport,
      createCases: () => ({
        readOnlyCases: [readOnlyCase],
        writeCases: [skippedWriteCase],
        experimentalWriteCases: [],
      }),
      log: (message) => logs.push(message),
    });

    assertEquals(exitCode, 0);
    assertEquals(logs.some((entry) => entry.includes("[pass] OK")), true);
    const report = await Deno.readTextFile(join(cwd, reportPath));
    assertStringIncludes(report, '"case-a"');
    assertStringIncludes(report, '"passed": 1');
    assertEquals(report.includes('"case-b"'), false);
  });
});
