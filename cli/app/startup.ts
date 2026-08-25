/**
 * Startup Progress
 *
 * The three-step checklist shown while the CLI comes up. Steps advance when
 * the work they name actually finishes. The module owns the spinner cadence
 * but never the pace. Nothing here sleeps, so startup costs what the work
 * costs.
 *
 * The clock and the terminal are injected, so the frame sequence is reachable
 * from a test without a real terminal or a real wait.
 */

import { writeStdout } from "veryfront/platform";
import { cursor, screen } from "../ui/ansi.ts";
import {
  createStartupState,
  incrementFrame,
  renderStartup,
  setStepActive,
  type StartupState,
} from "./views/startup.ts";

/** How often the active step's spinner advances. */
export const SPINNER_INTERVAL_MS = 60;

export interface StartupProgress {
  /** Mark the step at `index` active, everything before it is done. */
  begin(index: number): void;
  /** Mark every step done, paint a final time, and stop animating. */
  finish(): void;
  /**
   * Stop animating without claiming success, leaving the failed step visible
   * as the last one that was active. Use when startup threw.
   */
  stop(): void;
}

/** The terminal and the clock, injected so tests can supply their own. */
export interface StartupProgressDeps {
  write: (text: string) => void;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (handle: number) => void;
}

function platformDeps(): StartupProgressDeps {
  return {
    write: (text) => writeStdout(text),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle),
  };
}

/**
 * Begin painting the startup checklist. Returns a handle the caller advances
 * as each piece of real work completes.
 *
 * Stays in the alternate screen on `finish()` so the dashboard can take over
 * in place.
 */
export function startStartupProgress(
  stepLabels: string[],
  deps: StartupProgressDeps = platformDeps(),
): StartupProgress {
  let state: StartupState = createStartupState(stepLabels);
  let ticking = true;

  const paint = (): void => {
    deps.write(cursor.moveTo(1, 1) + screen.clearDown + "\n" + renderStartup(state));
  };

  deps.write(screen.altOn + cursor.hide);
  paint();

  const handle = deps.setInterval(() => {
    state = incrementFrame(state);
    paint();
  }, SPINNER_INTERVAL_MS);

  return {
    begin(index: number): void {
      if (!ticking) return;
      state = setStepActive(state, index);
      paint();
    },

    finish(): void {
      if (!ticking) return;
      ticking = false;
      // Past the last index, every step reads as done.
      state = setStepActive(state, stepLabels.length);
      deps.clearInterval(handle);
      paint();
    },

    stop(): void {
      if (!ticking) return;
      ticking = false;
      deps.clearInterval(handle);
      paint();
      // finish() stays in the alternate screen because the dashboard takes
      // over in place. A failure does not: the caller rethrows, so leaving it
      // on would print the error into a buffer nobody sees and exit with the
      // cursor still hidden.
      deps.write(cursor.show + screen.altOff);
    },
  };
}
