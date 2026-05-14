import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildFailureSuffix,
  buildProgressLine,
  containsOrderedSubsequence,
  createPlainTextPdf,
} from "./formatting.ts";

describe("agent testing live eval formatting", () => {
  it("detects ordered subsequences", () => {
    assertEquals(
      containsOrderedSubsequence(["a", "b", "c", "d"], ["b", "d"]),
      true,
    );
    assertEquals(
      containsOrderedSubsequence(["a", "b", "c"], ["c", "b"]),
      false,
    );
  });

  it("builds a pdf buffer with escaped line content", () => {
    const pdf = createPlainTextPdf(["Title (draft)", "Body \\ note"]);
    const text = pdf.toString("utf8");

    assertEquals(text.startsWith("%PDF-1.4"), true);
    assertStringIncludes(text, "Title \\(draft\\)");
    assertStringIncludes(text, "Body \\\\ note");
  });

  it("formats progress information with tool and text details", () => {
    const snapshot = {
      eventCount: 4,
      lastEventType: "STEP_STARTED",
      lastToolCallName: "load_skill",
      toolStarts: ["load_skill"],
      textLength: 12,
    };

    const progressLine = buildProgressLine({
      caseId: "starter-plan",
      startedAt: Date.now(),
      progress: snapshot,
    });

    assertStringIncludes(progressLine, "[progress] starter-plan");
    assertStringIncludes(progressLine, "events=4");
    assertStringIncludes(progressLine, "tool=load_skill");
    assertStringIncludes(progressLine, "text=12ch");

    const suffix = buildFailureSuffix(snapshot);
    assertStringIncludes(suffix, "events=4");
    assertStringIncludes(suffix, "tool=load_skill");
  });
});
