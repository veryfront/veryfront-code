/**
 * Live progress for `veryfront eval`.
 *
 * Model-backed records can take a minute or more each, and the report prints only once an eval
 * finishes. Without progress a healthy run is indistinguishable from a stalled one.
 *
 * An interactive terminal gets one spinner line redrawn in place. Anything else (pipes, CI,
 * `TERM=dumb`) gets plain lines on stderr: one per finished record, plus a heartbeat while a record
 * runs long, so logs stay readable and free of escape codes.
 */

import type { EvalProgressEvent } from "veryfront/eval";
import type { ProviderRequestRetryEvent } from "../../../src/provider/runtime-loader/provider-request-observer.ts";
import { writeStdout } from "veryfront/platform";
import { unrefTimer } from "../../../src/platform/compat/process/lifecycle.ts";
import { brand, dim, error as errorColor, muted, warning } from "#cli/ui";
import { formatDuration } from "../../ui/progress.ts";
import { getSpinnerFrame, screen } from "../../ui/ansi.ts";
import { SPINNER_INTERVAL_MS } from "../../ui/constants.ts";
import { isTTY } from "../../ui/layout.ts";
import { isAnimationDisabled } from "../../shared/animation.ts";
import { isJsonMode } from "../../shared/json-output.ts";
import { isQuiet, isVerbose } from "#cli/utils";
import { getEnv } from "#cli/process-env";

/** Plain-mode heartbeat interval while one record keeps running. */
export const EVAL_PROGRESS_HEARTBEAT_MS = 60_000;

export interface EvalProgressReporter {
  /** Announce the next eval. `position` is one-based. */
  startEval(input: { name: string; position: number; count: number }): void;
  /** Feed a runner progress event. */
  onEvent(event: EvalProgressEvent): void;
  /** Surface a provider request retry that would otherwise be silent. */
  onRetry(event: ProviderRequestRetryEvent): void;
  /** Describe work between records, such as billing finalization. */
  setPhase(text: string | undefined): void;
  /** Stop rendering and clear the live line. Safe to call more than once. */
  stop(): void;
}

export interface EvalProgressOutput {
  interactive: boolean;
  /** Writes raw text for the live line (interactive mode). */
  writeLive: (text: string) => void;
  /** Writes one complete line. */
  writeLine: (text: string) => void;
  now: () => number;
  heartbeatMs?: number;
}

function createNoopReporter(): EvalProgressReporter {
  return {
    startEval() {},
    onEvent() {},
    onRetry() {},
    setPhase() {},
    stop() {},
  };
}

/**
 * Debug logging writes its own lines while records run, and they would tear through a redrawn
 * spinner line, so debug runs get plain progress lines instead.
 */
function isDebugLogging(): boolean {
  return isVerbose() || getEnv("LOG_LEVEL")?.toUpperCase() === "DEBUG";
}

function defaultOutput(): EvalProgressOutput {
  return {
    interactive: isTTY() && !isAnimationDisabled() && !isDebugLogging(),
    writeLive: writeStdout,
    writeLine: (text) => console.error(text),
    now: () => Date.now(),
  };
}

/**
 * Create the eval progress reporter for the current CLI mode. `--quiet` and `--json` get a reporter
 * that prints nothing, so machine output stays clean.
 */
export function createEvalProgressReporter(
  output?: EvalProgressOutput,
): EvalProgressReporter {
  if (isQuiet() || isJsonMode()) return createNoopReporter();
  return createEvalProgressRenderer(output ?? defaultOutput());
}

function formatRetryReason(reason: string): string {
  return /^\d+$/.test(reason) ? `HTTP ${reason}` : reason;
}

/** Format one retry notice, e.g. `retrying model request (HTTP 429), attempt 2/3`. */
export function formatEvalRetryNotice(event: ProviderRequestRetryEvent): string {
  const delay = event.delayMs > 0 ? ` in ${formatDuration(event.delayMs)}` : "";
  return `Retrying model request (${
    formatRetryReason(event.reason)
  }), attempt ${event.attempt}/${event.maxAttempts}${delay}`;
}

/** Exported for tests: renders progress through the given output. */
export function createEvalProgressRenderer(output: EvalProgressOutput): EvalProgressReporter {
  const heartbeatMs = output.heartbeatMs ?? EVAL_PROGRESS_HEARTBEAT_MS;
  let evalLabel = "";
  let evalStartedAt = output.now();
  let total = 0;
  let finished = 0;
  let phase: string | undefined;
  let lastLineAt = output.now();
  const running = new Map<number, { exampleId: string; startedAt: number }>();
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let liveLineVisible = false;

  const counter = (): string => (total > 0 ? ` ${finished}/${total}` : "");

  const currentCase = (): string => {
    const [first, ...rest] = running.values();
    if (!first) return "";
    const more = rest.length > 0 ? ` +${rest.length} more` : "";
    return ` · case "${first.exampleId}"${more}`;
  };

  const liveText = (): string => {
    const elapsed = formatDuration(Math.max(0, output.now() - evalStartedAt));
    const detail = phase ? ` · ${phase}` : currentCase();
    return `${evalLabel}${counter()}${detail} · ${elapsed}`;
  };

  const render = (): void => {
    if (!evalLabel) return;
    output.writeLive(`${screen.clearLineReturn}  ${brand(getSpinnerFrame(frame))} ${liveText()}`);
    liveLineVisible = true;
  };

  const clearLive = (): void => {
    if (!liveLineVisible) return;
    output.writeLive(screen.clearLineReturn);
    liveLineVisible = false;
  };

  const ensureTimer = (): void => {
    if (timer !== undefined) return;
    timer = setInterval(() => {
      if (output.interactive) {
        frame++;
        render();
        return;
      }
      const now = output.now();
      if (running.size === 0 || now - lastLineAt < heartbeatMs) return;
      const [first] = running.values();
      printLine(
        `${muted("○")} ${evalLabel}${counter()} · still running case "${first!.exampleId}" (${
          formatDuration(now - first!.startedAt)
        })`,
      );
    }, output.interactive ? SPINNER_INTERVAL_MS : Math.min(heartbeatMs, 5_000));
    // The timer only renders progress; it must never keep the CLI alive.
    unrefTimer(timer);
  };

  /** Print a persistent line. In interactive mode the live line is redrawn under it. */
  const printLine = (text: string): void => {
    clearLive();
    output.writeLine(`  ${text}`);
    lastLineAt = output.now();
    if (output.interactive) render();
  };

  return {
    startEval({ name, position, count }) {
      evalLabel = count > 1 ? `[eval ${position}/${count}] ${name}` : name;
      evalStartedAt = output.now();
      total = 0;
      finished = 0;
      phase = undefined;
      running.clear();
      ensureTimer();
      if (output.interactive) render();
    },
    onEvent(event) {
      switch (event.type) {
        case "eval-started":
          total = event.total;
          if (!output.interactive) {
            printLine(
              `${brand("●")} ${evalLabel}: running ${event.total} ${
                event.total === 1 ? "case" : "cases"
              }`,
            );
          }
          break;
        case "record-started":
          running.set(event.index, { exampleId: event.exampleId, startedAt: output.now() });
          break;
        case "record-finished": {
          running.delete(event.index);
          finished++;
          if (!output.interactive) {
            const icon = event.completed ? "✓" : errorColor("✗");
            const status = event.completed ? "" : ", failed";
            printLine(
              `${icon} ${evalLabel} ${finished}/${event.total} · case "${event.exampleId}" ${
                dim(`(${formatDuration(event.durationMs)}${status})`)
              }`,
            );
          }
          break;
        }
      }
      if (output.interactive) render();
    },
    onRetry(event) {
      printLine(`${warning("!")} ${formatEvalRetryNotice(event)}`);
    },
    setPhase(text) {
      phase = text;
      if (output.interactive) render();
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      clearLive();
      evalLabel = "";
    },
  };
}
