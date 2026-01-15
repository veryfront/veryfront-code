/**
 * Progress Indicators for CLI
 *
 * Provides spinners, step indicators, and progress bars
 * following CLI UX best practices.
 */

import { brand, dim, error, muted, success } from "./colors.ts";
import { isTTY } from "./layout.ts";

/**
 * Spinner character frames (Braille dots pattern)
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Step states
 */
export type StepStatus = "pending" | "active" | "completed" | "error";

export interface Step {
  label: string;
  status: StepStatus;
  duration?: number; // ms
}

/**
 * Format a step line with appropriate icon and styling
 */
export function formatStep(step: Step, spinnerFrame = 0): string {
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";

  switch (step.status) {
    case "completed": {
      const durationText = step.duration !== undefined
        ? dim(` (${formatDuration(step.duration)})`)
        : "";
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

/**
 * Render multiple steps as a list
 */
export function renderSteps(steps: Step[], spinnerFrame = 0): string {
  return steps.map((step) => `  ${formatStep(step, spinnerFrame)}`).join("\n");
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Progress bar (X of Y with visual bar)
 */
export function progressBar(
  current: number,
  total: number,
  options: {
    width?: number;
    label?: string;
    showPercent?: boolean;
  } = {},
): string {
  const { width = 20, label, showPercent = true } = options;

  const percent = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = brand("█".repeat(filled)) + muted("░".repeat(empty));

  const parts: string[] = [];
  if (label) parts.push(label);
  parts.push(`[${bar}]`);
  if (showPercent) parts.push(dim(`${percent}%`));
  parts.push(dim(`${current}/${total}`));

  return parts.join(" ");
}

/**
 * Simple X of Y progress
 */
export function xOfY(current: number, total: number, label?: string): string {
  const parts: string[] = [];
  if (label) parts.push(label);
  parts.push(`${current} / ${total}`);
  return parts.join(": ");
}

/**
 * Spinner controller for animated spinners
 */
export interface SpinnerController {
  /** Update the spinner text */
  update: (text: string) => void;
  /** Stop with success */
  success: (text?: string) => void;
  /** Stop with error */
  error: (text?: string) => void;
  /** Stop without status */
  stop: () => void;
}

/**
 * Create an animated spinner
 * Returns a controller to update/stop the spinner
 */
export function createSpinner(text: string): SpinnerController {
  if (!isTTY()) {
    // Non-interactive: just print the text
    console.log(`  ${muted("○")} ${text}`);
    return {
      update: (newText: string) => console.log(`  ${muted("○")} ${newText}`),
      success: (newText?: string) => console.log(`  ${success("✓")} ${newText || text}`),
      error: (newText?: string) => console.log(`  ${error("✗")} ${newText || text}`),
      stop: () => {},
    };
  }

  let currentText = text;
  let frame = 0;
  let running = true;

  const write = (s: string) => Deno.stdout.writeSync(new TextEncoder().encode(s));
  const clearLine = "\x1b[2K\r";

  // Render current frame
  const render = () => {
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
    write(`${clearLine}  ${brand(spinner)} ${currentText}`);
  };

  // Start animation
  render();
  const interval = setInterval(() => {
    if (!running) return;
    frame++;
    render();
  }, 80);

  return {
    update(newText: string) {
      currentText = newText;
      render();
    },
    success(finalText?: string) {
      running = false;
      clearInterval(interval);
      write(`${clearLine}  ${success("✓")} ${finalText || currentText}\n`);
    },
    error(finalText?: string) {
      running = false;
      clearInterval(interval);
      write(`${clearLine}  ${error("✗")} ${finalText || currentText}\n`);
    },
    stop() {
      running = false;
      clearInterval(interval);
      write(`${clearLine}`);
    },
  };
}

/**
 * Simple inline spinner (non-animated, for logs)
 */
export function inlineSpinner(text: string, frame = 0): string {
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
  return `${brand(spinner)} ${text}`;
}

/**
 * Task list renderer with animation support
 */
export class TaskList {
  private tasks: Step[] = [];
  private frame = 0;
  private interval: number | null = null;

  add(label: string): number {
    const index = this.tasks.length;
    this.tasks.push({ label, status: "pending" });
    return index;
  }

  start(index: number): void {
    const task = this.tasks[index];
    if (task) {
      task.status = "active";
      (task as { startTime?: number }).startTime = Date.now();
    }
  }

  complete(index: number): void {
    const task = this.tasks[index] as Step & { startTime?: number };
    if (task) {
      task.status = "completed";
      if (task.startTime) {
        task.duration = Date.now() - task.startTime;
      }
    }
  }

  fail(index: number): void {
    const task = this.tasks[index];
    if (task) {
      task.status = "error";
    }
  }

  render(): string {
    return renderSteps(this.tasks, this.frame);
  }

  startAnimation(onFrame: (output: string) => void): void {
    this.stopAnimation();
    onFrame(this.render());
    this.interval = setInterval(() => {
      this.frame++;
      onFrame(this.render());
    }, 80);
  }

  stopAnimation(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
