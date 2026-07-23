import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildProgressLine,
  buildRuntimePerformanceSummary,
  createPassedEvalResult,
  createPlainTextPdf,
  resolveLiveEvalRequestedCaseIds,
  selectLiveEvalCases,
} from "veryfront/eval/agent-service";

describe("eval/live-eval utilities", () => {
  it("rejects invalid performance durations", () => {
    for (const durationMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => buildRuntimePerformanceSummary([{ runtime: "framework", durationMs }]),
        Error,
        "durationMs",
      );
    }
  });

  it("rejects unknown and duplicate selected case ids", () => {
    const first = { id: "first" };
    assertThrows(
      () =>
        selectLiveEvalCases({
          allCases: [first],
          readOnlyCases: [first],
          writeCases: [],
          experimentalWriteCases: [],
          requestedCaseIds: new Set(["missing"]),
          runWriteEvals: false,
          runExperimentalWriteEvals: false,
        }),
      Error,
      "Unknown live eval case",
    );
    assertThrows(
      () =>
        selectLiveEvalCases({
          allCases: [first, { id: "first" }],
          readOnlyCases: [first],
          writeCases: [],
          experimentalWriteCases: [],
          requestedCaseIds: new Set(),
          runWriteEvals: false,
          runExperimentalWriteEvals: false,
        }),
      Error,
      "Duplicate live eval case",
    );
  });

  it("does not resolve inherited object properties as case sets", () => {
    assertThrows(
      () =>
        resolveLiveEvalRequestedCaseIds({
          caseSets: {},
          requestedCaseIds: new Set(),
          requestedCaseSetId: "toString",
        }),
      Error,
      "Unknown AG_UI_EVAL_CASE_SET",
    );
    assertEquals(
      resolveLiveEvalRequestedCaseIds({
        caseSets: { smoke: ["first"] },
        requestedCaseIds: new Set(),
        requestedCaseSetId: "smoke",
      }),
      new Set(["first"]),
    );
  });

  it("keeps progress logs single-line and redacts secret-like fields", () => {
    const line = buildProgressLine({
      caseId: "case\nspoofed",
      startedAt: Date.now(),
      progress: {
        eventCount: 1,
        lastEventType: "event\nspoofed",
        lastToolCallName: "tool token=sensitive",
        toolStarts: ["first", "second\nspoofed"],
        textLength: 4,
      },
    });

    assertEquals(line.includes("\n"), false);
    assertEquals(line.includes("sensitive"), false);
  });

  it("creates bounded, paginated PDF output", () => {
    const pdf = createPlainTextPdf(
      Array.from({ length: 40 }, (_, index) => `line ${index} (escaped)`),
    ).toString("utf8");

    assertStringIncludes(pdf, "/Count 2");
    assertStringIncludes(pdf, "line 0 \\(escaped\\)");
    assertStringIncludes(pdf, "line 39 \\(escaped\\)");
    assertStringIncludes(pdf, "%%EOF");
    assertThrows(
      () => createPlainTextPdf(["x".repeat(88 * 32 * 1_001)]),
      TypeError,
      "pages",
    );
  });

  it("bounds live result evidence and clamps clock regressions", () => {
    const result = createPassedEvalResult({
      id: "case",
      label: "Case",
      runtime: "framework",
      details: "OK",
      startedAt: Date.now() + 1_000,
      toolStarts: ["tool token=test-value"],
      toolArgsPreview: "authorization=test-value",
      textPreview: "password=test-value",
    });

    assertEquals(result.durationMs, 0);
    assertEquals(result.toolStarts, ["tool token=<REDACTED>"]);
    assertEquals(result.toolArgsPreview, "authorization=<REDACTED>");
    assertEquals(result.textPreview, "password=<REDACTED>");
    assertThrows(
      () =>
        createPassedEvalResult({
          id: "case",
          label: "Case",
          runtime: "framework",
          details: "OK",
          startedAt: Number.NaN,
        }),
      TypeError,
      "startedAt",
    );
  });
});
