/**
 * Startup Animation
 *
 * Shows the startup animation with boxed view and shimmer effect.
 */

import { writeStdout } from "#veryfront/platform/compat/process.ts";
import { cursor, screen } from "../ui/ansi.ts";
import {
  createStartupState,
  incrementFrame,
  renderStartup,
  setStepActive,
} from "./views/startup.ts";

/**
 * Show startup animation with boxed view and shimmer effect
 */
export async function showStartup(steps: string[]): Promise<void> {
  const write = (text: string): void => writeStdout(text);

  write(screen.altOn + cursor.hide);

  let startupState = createStartupState(steps);

  // Show each step with spinning avatar animation
  for (let i = 0; i < steps.length; i++) {
    startupState = setStepActive(startupState, i);

    // Animate spinning avatar (16 frames at 60ms = ~1s per step for full rotation)
    const framesPerStep = 16;
    for (let f = 0; f < framesPerStep; f++) {
      write(cursor.moveTo(1, 1) + screen.clearDown + "\n" + renderStartup(startupState));
      startupState = incrementFrame(startupState);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  // Mark all steps done - logo fills up and holds before transitioning
  startupState = setStepActive(startupState, steps.length);
  write(cursor.moveTo(1, 1) + screen.clearDown + "\n" + renderStartup(startupState));
  await new Promise((r) => setTimeout(r, 400));

  // Don't exit alternate screen - let app.start() continue in it
  // Dashboard takes over directly from here
}
