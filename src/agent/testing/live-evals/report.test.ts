import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildLiveEvalCaseTagSummary,
  buildLiveEvalRuntimeSummary,
  buildLiveEvalStatusSummary,
  hasEveryLiveEvalTag,
  resolveLiveEvalRequestedCaseIds,
  selectLiveEvalCases,
} from "./report.ts";

describe("agent testing live eval report", () => {
  it("selects configured write-mode cases when no explicit cases are requested", () => {
    const readOnlyCases = [{ id: "a" }, { id: "b" }];
    const writeCases = [{ id: "c" }];
    const experimentalWriteCases = [{ id: "d" }];

    assertEquals(
      selectLiveEvalCases({
        allCases: [...readOnlyCases, ...writeCases, ...experimentalWriteCases],
        readOnlyCases,
        writeCases,
        experimentalWriteCases,
        requestedCaseIds: new Set(),
        runWriteEvals: true,
        runExperimentalWriteEvals: false,
      }),
      [{ id: "a" }, { id: "b" }, { id: "c" }],
    );
  });

  it("honors explicit case selection regardless of write flags", () => {
    const cases = [{ id: "a" }, { id: "d" }];
    assertEquals(
      selectLiveEvalCases({
        allCases: cases,
        readOnlyCases: [{ id: "a" }],
        writeCases: [],
        experimentalWriteCases: [{ id: "d" }],
        requestedCaseIds: new Set(["d"]),
        runWriteEvals: false,
        runExperimentalWriteEvals: false,
      }),
      [{ id: "d" }],
    );
  });

  it("filters selected cases by requested metadata tags", () => {
    const cases = [
      { id: "a", metadata: { tags: ["gate:ci", "surface:read-only"] } },
      { id: "b", metadata: { tags: ["gate:nightly", "surface:read-only"] } },
    ];

    assertEquals(
      selectLiveEvalCases({
        allCases: cases,
        readOnlyCases: cases,
        writeCases: [],
        experimentalWriteCases: [],
        requestedCaseIds: new Set(),
        requestedCaseTags: new Set(["gate:ci"]),
        runWriteEvals: false,
        runExperimentalWriteEvals: false,
      }),
      [{ id: "a", metadata: { tags: ["gate:ci", "surface:read-only"] } }],
    );
  });

  it("resolves named case sets from caller-provided definitions", () => {
    const caseSets = {
      smoke: ["a", "b"],
      durable: ["c"],
    };

    assertEquals(
      resolveLiveEvalRequestedCaseIds({
        caseSets,
        requestedCaseIds: new Set(["explicit"]),
        requestedCaseSetId: "smoke",
      }),
      new Set(["explicit", "a", "b"]),
    );

    assertThrows(
      () =>
        resolveLiveEvalRequestedCaseIds({
          caseSets,
          requestedCaseIds: new Set(),
          requestedCaseSetId: "unknown",
        }),
      Error,
      'Unknown AG_UI_EVAL_CASE_SET "unknown". Known sets: smoke, durable',
    );
  });

  it("builds status and runtime summaries", () => {
    const results = [
      { runtime: "framework" as const, status: "pass" as const },
      { runtime: "framework" as const, status: "fail" as const },
      { runtime: "framework" as const, status: "skip" as const },
    ];

    assertEquals(buildLiveEvalStatusSummary(results), {
      passed: 1,
      failed: 1,
      skipped: 1,
    });
    assertEquals(buildLiveEvalRuntimeSummary(["framework"], results), {
      framework: { passed: 1, failed: 1, skipped: 1 },
    });
  });

  it("summarizes tags and checks requested tags", () => {
    const tags = ["gate:ci", "surface:read-only"];
    assertEquals(hasEveryLiveEvalTag(tags, new Set(["gate:ci"])), true);
    assertEquals(hasEveryLiveEvalTag(tags, new Set(["gate:release"])), false);
    assertEquals(
      buildLiveEvalCaseTagSummary([
        { metadata: { tags: ["gate:ci", "surface:read-only"] } },
        { metadata: { tags: ["gate:ci"] } },
      ]),
      { "gate:ci": 2, "surface:read-only": 1 },
    );
  });
});
