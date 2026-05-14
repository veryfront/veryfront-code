import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createFailedEvalResult,
  createPassedEvalResult,
  createSkippedEvalResult,
} from "./result.ts";

describe("agent testing live eval result", () => {
  it("builds a skipped result with elapsed duration", () => {
    const originalNow = Date.now;
    Date.now = () => 1500;
    try {
      assertEquals(
        createSkippedEvalResult({
          id: "case-a",
          label: "Case A",
          runtime: "framework",
          details: "skipped",
          startedAt: 1000,
        }),
        {
          id: "case-a",
          label: "Case A",
          runtime: "framework",
          status: "skip",
          details: "skipped",
          durationMs: 500,
        },
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("builds a failed result with optional trace/tool context", () => {
    const originalNow = Date.now;
    Date.now = () => 2200;
    try {
      assertEquals(
        createFailedEvalResult({
          id: "case-b",
          label: "Case B",
          runtime: "framework",
          details: "failed",
          startedAt: 1000,
          conversationId: "conv-1",
          runId: "run-1",
          artifactPaths: ["/plans/eval.md"],
          traceSignature: "A > B",
          toolStarts: ["load_skill"],
          toolArgsPreview: '{"skillId":"plan"}',
          textPreview: "partial",
        }),
        {
          id: "case-b",
          label: "Case B",
          runtime: "framework",
          status: "fail",
          details: "failed",
          durationMs: 1200,
          conversationId: "conv-1",
          runId: "run-1",
          artifactPaths: ["/plans/eval.md"],
          traceSignature: "A > B",
          toolStarts: ["load_skill"],
          toolArgsPreview: '{"skillId":"plan"}',
          textPreview: "partial",
        },
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("builds a passed result with optional trace/tool context", () => {
    const originalNow = Date.now;
    Date.now = () => 3100;
    try {
      assertEquals(
        createPassedEvalResult({
          id: "case-c",
          label: "Case C",
          runtime: "framework",
          details: "passed",
          startedAt: 1000,
          artifactPaths: ["/plans/eval.md"],
          traceSignature: "A > B > C",
          toolStarts: ["invoke_agent"],
        }),
        {
          id: "case-c",
          label: "Case C",
          runtime: "framework",
          status: "pass",
          details: "passed",
          durationMs: 2100,
          artifactPaths: ["/plans/eval.md"],
          traceSignature: "A > B > C",
          toolStarts: ["invoke_agent"],
        },
      );
    } finally {
      Date.now = originalNow;
    }
  });
});
