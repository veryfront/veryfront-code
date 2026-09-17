import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { setQuietMode } from "../../utils/index.ts";
import { stripAnsi } from "../../ui/ansi.ts";
import {
  createEvalProgressRenderer,
  createEvalProgressReporter,
  type EvalProgressOutput,
  type EvalProgressReporter,
  formatEvalRetryNotice,
} from "./progress.ts";

function createOutput(interactive: boolean) {
  let now = 0;
  const lines: string[] = [];
  const live: string[] = [];
  const output: EvalProgressOutput = {
    interactive,
    writeLine: (text) => lines.push(stripAnsi(text)),
    writeLive: (text) => live.push(stripAnsi(text)),
    now: () => now,
  };
  return {
    output,
    lines,
    live,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function runTwoCases(reporter: EvalProgressReporter, advance: (ms: number) => void): void {
  reporter.startEval({ name: "disposition-agent", position: 2, count: 3 });
  reporter.onEvent({ type: "eval-started", evalId: "eval:disposition-agent", total: 2 });
  reporter.onEvent({
    type: "record-started",
    evalId: "eval:disposition-agent",
    recordId: "label-and-move:1",
    exampleId: "label-and-move",
    repetition: 1,
    index: 0,
    total: 2,
  });
  advance(61_000);
  reporter.onEvent({
    type: "record-finished",
    evalId: "eval:disposition-agent",
    recordId: "label-and-move:1",
    exampleId: "label-and-move",
    repetition: 1,
    index: 0,
    total: 2,
    completed: true,
    durationMs: 61_000,
  });
  reporter.onEvent({
    type: "record-started",
    evalId: "eval:disposition-agent",
    recordId: "archive:1",
    exampleId: "archive",
    repetition: 1,
    index: 1,
    total: 2,
  });
}

describe("eval progress", () => {
  it("prints one plain line per finished case without escape codes outside a terminal", () => {
    const { output, lines, live, advance } = createOutput(false);
    const reporter = createEvalProgressRenderer(output);
    try {
      runTwoCases(reporter, advance);
      reporter.onEvent({
        type: "record-finished",
        evalId: "eval:disposition-agent",
        recordId: "archive:1",
        exampleId: "archive",
        repetition: 1,
        index: 1,
        total: 2,
        completed: false,
        durationMs: 1_500,
      });
    } finally {
      reporter.stop();
    }

    assertEquals(lines, [
      "  ● [eval 2/3] disposition-agent: running 2 cases",
      '  ✓ [eval 2/3] disposition-agent 1/2 · case "label-and-move" (1m 1s)',
      '  ✗ [eval 2/3] disposition-agent 2/2 · case "archive" (1.5s, failed)',
    ]);
    assertEquals(live, []);
  });

  it("redraws one live line with the eval, count, current case, and elapsed time in a terminal", () => {
    const { output, lines, live, advance } = createOutput(true);
    const reporter = createEvalProgressRenderer(output);
    try {
      runTwoCases(reporter, advance);
    } finally {
      reporter.stop();
    }

    assertEquals(lines, []);
    // Each frame is "<clear line>\r  <spinner> <text>".
    const lastFrame = live.at(-2)?.split("\r").at(-1)?.trim();
    assertEquals(
      lastFrame?.slice(lastFrame.indexOf(" ") + 1),
      '[eval 2/3] disposition-agent 1/2 · case "archive" · 1m 1s',
    );
    assertEquals(live.at(-1)?.split("\r").at(-1), "", "stop clears the live line");
  });

  it("prints a heartbeat while one case keeps running outside a terminal", async () => {
    const { output, lines } = createOutput(false);
    const reporter = createEvalProgressRenderer({
      ...output,
      // Real elapsed time, so the heartbeat interval can observe it.
      now: () => Date.now(),
      heartbeatMs: 20,
    });
    try {
      reporter.startEval({ name: "orchestrator-agent", position: 1, count: 1 });
      reporter.onEvent({ type: "eval-started", evalId: "eval:orchestrator-agent", total: 1 });
      reporter.onEvent({
        type: "record-started",
        evalId: "eval:orchestrator-agent",
        recordId: "long-case:1",
        exampleId: "long-case",
        repetition: 1,
        index: 0,
        total: 1,
      });
      await waitFor(() => lines.some((line) => line.includes("still running")), {
        timeout: 5_000,
        interval: 10,
      });
    } finally {
      reporter.stop();
    }

    const heartbeat = lines.find((line) => line.includes("still running"));
    assertEquals(
      heartbeat?.replace(/\([^)]*\)$/, "").trim(),
      '○ orchestrator-agent 0/1 · still running case "long-case"',
    );
  });

  it("advances the spinner and shows the current phase in a terminal", async () => {
    const { output, live } = createOutput(true);
    const reporter = createEvalProgressRenderer({ ...output, now: () => Date.now() });
    try {
      reporter.startEval({ name: "orchestrator-agent", position: 1, count: 1 });
      reporter.onEvent({ type: "eval-started", evalId: "eval:orchestrator-agent", total: 1 });
      const framesAtStart = live.length;
      await waitFor(() => live.length > framesAtStart, { timeout: 5_000, interval: 10 });
      reporter.setPhase("finalizing usage");
    } finally {
      reporter.stop();
    }

    assertEquals(
      live.some((frame) => frame.includes("· finalizing usage ·")),
      true,
      "the live line names the current phase",
    );
  });

  it("prints a retry notice above the live line", () => {
    const { output, lines, advance } = createOutput(true);
    const reporter = createEvalProgressRenderer(output);
    try {
      runTwoCases(reporter, advance);
      reporter.onRetry({
        providerLabel: "veryfront-cloud",
        modelId: "claude-sonnet-4-6",
        reason: "429",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 1_000,
      });
    } finally {
      reporter.stop();
    }

    assertEquals(lines, ["  ! Retrying model request (HTTP 429), attempt 2/3 in 1.0s"]);
  });

  it("names a header timeout retry without a delay", () => {
    assertEquals(
      formatEvalRetryNotice({
        providerLabel: "veryfront-cloud",
        reason: "timeout",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 0,
      }),
      "Retrying model request (timeout), attempt 2/3",
    );
  });

  it("prints nothing under --quiet or --json", () => {
    for (const mode of ["quiet", "json"] as const) {
      const { output, lines, live, advance } = createOutput(false);
      if (mode === "quiet") setQuietMode(true);
      else setJsonMode(true);
      try {
        const reporter = createEvalProgressReporter(output);
        runTwoCases(reporter, advance);
        reporter.onRetry({
          providerLabel: "veryfront-cloud",
          reason: "503",
          attempt: 2,
          maxAttempts: 3,
          delayMs: 0,
        });
        reporter.stop();
      } finally {
        setQuietMode(false);
        setJsonMode(false);
      }
      assertEquals([...lines, ...live], [], `${mode} mode must stay silent`);
    }
  });
});
