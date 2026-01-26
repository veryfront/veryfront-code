/****
 * Progress Indicators for CLI
 *
 * Provides spinners, step indicators, and progress bars
 * following CLI UX best practices.
 * Runtime-agnostic: works on Deno, Node.js, and Bun.
 */
import * as dntShim from "../../../_dnt.shims.js";


import { writeStdout } from "../../platform/compat/process.js";
import { brand, dim, error, muted, success } from "./colors.js";
import { isTTY } from "./layout.js";
import { getSpinnerFrame, screen } from "./ansi.js";
import {
  DEFAULT_PROGRESS_BAR_WIDTH,
  DURATION_MINUTES_THRESHOLD_MS,
  DURATION_SECONDS_THRESHOLD_MS,
  SPINNER_INTERVAL_MS,
} from "./constants.js";

const write = writeStdout;

export type StepStatus = "pending" | "active" | "completed" | "error";

export interface Step {
  label: string;
  status: StepStatus;
  duration?: number; // ms
}

export function formatStep(step: Step, spinnerFrame = 0): string {
  const spinner = getSpinnerFrame(spinnerFrame);

  switch (step.status) {
    case "completed": {
      const durationText = step.duration === undefined
        ? ""
        : dim(` (${formatDuration(step.duration)})`);
      return `${success("✓")} ${dim(step.label)}${durationText}`;
    }
    case "error":
      return `${error("✗")} ${step.label}`;
    case "active":
      return `${brand(spinner)} ${step.label}`;
    case "pending":
    default:
      return `${muted("○")} ${muted(step.label)}`;
  }
}

export function renderSteps(steps: Step[], spinnerFrame = 0): string {
  return steps.map((step) => `  ${formatStep(step, spinnerFrame)}`).join("\n");
}

export function formatDuration(ms: number): string {
  if (ms < DURATION_SECONDS_THRESHOLD_MS) return `${ms}ms`;

  if (ms < DURATION_MINUTES_THRESHOLD_MS) {
    return `${(ms / DURATION_SECONDS_THRESHOLD_MS).toFixed(1)}s`;
  }

  const mins = Math.floor(ms / DURATION_MINUTES_THRESHOLD_MS);
  const secs = Math.round(
    (ms % DURATION_MINUTES_THRESHOLD_MS) / DURATION_SECONDS_THRESHOLD_MS,
  );
  return `${mins}m ${secs}s`;
}

export function progressBar(
  current: number,
  total: number,
  options: {
    width?: number;
    label?: string;
    showPercent?: boolean;
  } = {},
): string {
  const { width = DEFAULT_PROGRESS_BAR_WIDTH, label, showPercent = true } = options;

  const ratio = current / total;
  const percent = Math.round(ratio * 100);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  const bar = brand("█".repeat(filled)) + muted("░".repeat(empty));

  const parts: string[] = [];
  if (label) parts.push(label);
  parts.push(`[${bar}]`);
  if (showPercent) parts.push(dim(`${percent}%`));
  parts.push(dim(`${current}/${total}`));

  return parts.join(" ");
}

export function xOfY(current: number, total: number, label?: string): string {
  const parts: string[] = [];
  if (label) parts.push(label);
  parts.push(`${current} / ${total}`);
  return parts.join(": ");
}

export interface SpinnerController {
  update: (text: string) => void;
  success: (text?: string) => void;
  error: (text?: string) => void;
  stop: () => void;
}

export function createSpinner(text: string): SpinnerController {
  if (!isTTY()) {
    const print = (prefix: string, msg: string) => console.log(`  ${prefix} ${msg}`);

    print(muted("○"), text);

    return {
      update: (newText: string) => print(muted("○"), newText),
      success: (newText?: string) => print(success("✓"), newText ?? text),
      error: (newText?: string) => print(error("✗"), newText ?? text),
      stop: () => {},
    };
  }

  let currentText = text;
  let frame = 0;
  let running = true;

  const render = (): void => {
    const spinner = getSpinnerFrame(frame);
    write(`${screen.clearLineReturn}  ${brand(spinner)} ${currentText}`);
  };

  render();

  const interval = dntShim.setInterval(() => {
    if (!running) return;
    frame++;
    render();
  }, SPINNER_INTERVAL_MS);

  const stopInterval = (): void => {
    running = false;
    clearInterval(interval);
  };

  return {
    update(newText: string) {
      currentText = newText;
      render();
    },
    success(finalText?: string) {
      stopInterval();
      write(`${screen.clearLineReturn}  ${success("✓")} ${finalText ?? currentText}\n`);
    },
    error(finalText?: string) {
      stopInterval();
      write(`${screen.clearLineReturn}  ${error("✗")} ${finalText ?? currentText}\n`);
    },
    stop() {
      stopInterval();
      write(`${screen.clearLineReturn}`);
    },
  };
}

export function inlineSpinner(text: string, frame = 0): string {
  return `${brand(getSpinnerFrame(frame))} ${text}`;
}

export class TaskList {
  private tasks: Array<Step & { startTime?: number }> = [];
  private frame = 0;
  private interval: number | null = null;

  add(label: string): number {
    const index = this.tasks.length;
    this.tasks.push({ label, status: "pending" });
    return index;
  }

  start(index: number): void {
    const task = this.tasks[index];
    if (!task) return;

    task.status = "active";
    task.startTime = Date.now();
  }

  complete(index: number): void {
    const task = this.tasks[index];
    if (!task) return;

    task.status = "completed";
    if (task.startTime) task.duration = Date.now() - task.startTime;
  }

  fail(index: number): void {
    const task = this.tasks[index];
    if (!task) return;

    task.status = "error";
  }

  render(): string {
    return renderSteps(this.tasks, this.frame);
  }

  startAnimation(onFrame: (output: string) => void): void {
    this.stopAnimation();
    onFrame(this.render());

    this.interval = dntShim.setInterval(() => {
      this.frame++;
      onFrame(this.render());
    }, SPINNER_INTERVAL_MS);
  }

  stopAnimation(): void {
    if (this.interval === null) return;
    clearInterval(this.interval);
    this.interval = null;
  }
}
