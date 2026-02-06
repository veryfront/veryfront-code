import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatDuration,
  formatStep,
  progressBar,
  renderSteps,
  type Step,
  TaskList,
  xOfY,
} from "./progress.ts";
import { stripAnsi } from "./ansi.ts";

describe("cli/ui/progress", () => {
  describe("formatDuration", () => {
    it("should format milliseconds below 1 second", () => {
      assertEquals(formatDuration(500), "500ms");
    });

    it("should format exactly 0ms", () => {
      assertEquals(formatDuration(0), "0ms");
    });

    it("should format seconds", () => {
      assertEquals(formatDuration(2500), "2.5s");
    });

    it("should format exactly 1 second", () => {
      assertEquals(formatDuration(1000), "1.0s");
    });

    it("should format minutes and seconds", () => {
      assertEquals(formatDuration(90000), "1m 30s");
    });

    it("should format exactly 1 minute", () => {
      assertEquals(formatDuration(60000), "1m 0s");
    });

    it("should format large durations", () => {
      assertEquals(formatDuration(125000), "2m 5s");
    });
  });

  describe("formatStep", () => {
    it("should format completed step with checkmark", () => {
      const step: Step = { label: "Build", status: "completed" };
      const result = stripAnsi(formatStep(step));
      assertEquals(result.includes("Build"), true);
    });

    it("should format completed step with duration", () => {
      const step: Step = { label: "Build", status: "completed", duration: 1500 };
      const result = stripAnsi(formatStep(step));
      assertEquals(result.includes("1.5s"), true);
    });

    it("should format error step", () => {
      const step: Step = { label: "Test", status: "error" };
      const result = stripAnsi(formatStep(step));
      assertEquals(result.includes("Test"), true);
    });

    it("should format active step with spinner", () => {
      const step: Step = { label: "Loading", status: "active" };
      const result = formatStep(step, 0);
      assertEquals(result.includes("Loading"), true);
    });

    it("should format pending step", () => {
      const step: Step = { label: "Deploy", status: "pending" };
      const result = stripAnsi(formatStep(step));
      assertEquals(result.includes("Deploy"), true);
    });
  });

  describe("renderSteps", () => {
    it("should render multiple steps", () => {
      const steps: Step[] = [
        { label: "Build", status: "completed" },
        { label: "Test", status: "active" },
        { label: "Deploy", status: "pending" },
      ];
      const result = renderSteps(steps);
      for (const { label } of steps) {
        assertEquals(result.includes(label), true);
      }
    });

    it("should handle empty steps array", () => {
      assertEquals(renderSteps([]), "");
    });
  });

  describe("progressBar", () => {
    it("should render a progress bar at 50%", () => {
      const result = stripAnsi(progressBar(5, 10));
      assertEquals(result.includes("50%"), true);
      assertEquals(result.includes("5/10"), true);
    });

    it("should render at 0%", () => {
      const result = stripAnsi(progressBar(0, 10));
      assertEquals(result.includes("0%"), true);
    });

    it("should render at 100%", () => {
      const result = stripAnsi(progressBar(10, 10));
      assertEquals(result.includes("100%"), true);
    });

    it("should include label when provided", () => {
      const result = stripAnsi(progressBar(3, 10, { label: "Loading" }));
      assertEquals(result.includes("Loading"), true);
    });

    it("should hide percent when showPercent is false", () => {
      const result = stripAnsi(progressBar(5, 10, { showPercent: false }));
      assertEquals(result.includes("%"), false);
    });
  });

  describe("xOfY", () => {
    it("should format x of y", () => {
      assertEquals(xOfY(3, 10), "3 / 10");
    });

    it("should include label", () => {
      assertEquals(xOfY(3, 10, "Files"), "Files: 3 / 10");
    });

    it("should handle zero values", () => {
      assertEquals(xOfY(0, 0), "0 / 0");
    });
  });

  describe("TaskList", () => {
    it("should add tasks and return indices", () => {
      const list = new TaskList();
      assertEquals(list.add("First"), 0);
      assertEquals(list.add("Second"), 1);
    });

    it("should render added tasks", () => {
      const list = new TaskList();
      list.add("Build");
      list.add("Test");
      const output = list.render();
      assertEquals(output.includes("Build"), true);
      assertEquals(output.includes("Test"), true);
    });

    it("should transition task through statuses", () => {
      const list = new TaskList();
      const idx = list.add("Build");

      assertEquals(stripAnsi(list.render()).includes("Build"), true);

      list.start(idx);
      assertEquals(list.render().includes("Build"), true);

      list.complete(idx);
      assertEquals(list.render().includes("Build"), true);
    });

    it("should handle fail status", () => {
      const list = new TaskList();
      const idx = list.add("Test");
      list.start(idx);
      list.fail(idx);
      assertEquals(list.render().includes("Test"), true);
    });

    it("should handle start/complete/fail on invalid index", () => {
      const list = new TaskList();
      list.start(999);
      list.complete(999);
      list.fail(999);
    });

    it("should start and stop animation", () => {
      const list = new TaskList();
      list.add("Task");
      const frames: string[] = [];
      list.startAnimation((output) => frames.push(output));
      assertEquals(frames.length >= 1, true);
      list.stopAnimation();
    });

    it("should handle stopAnimation when not started", () => {
      const list = new TaskList();
      list.stopAnimation();
    });
  });
});
