import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for startup progress.
 *
 * The clock and the terminal are injected, so these run with no real terminal
 * and no real waiting.
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startStartupProgress, type StartupProgressDeps } from "./startup.ts";

const STEPS = ["Loading configuration", "Discovering projects", "Starting server"];

interface FakeTerminal extends StartupProgressDeps {
  /** Everything written, one entry per write call. */
  writes: string[];
  /** Advance the injected clock by `n` spinner ticks. */
  tick(n?: number): void;
  cleared: boolean;
  /** The most recent painted frame, ANSI stripped. */
  screen(): string;
}

// deno-lint-ignore no-control-regex
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;

function fakeTerminal(): FakeTerminal {
  const writes: string[] = [];
  let ticker: (() => void) | null = null;
  let cleared = false;

  return {
    writes,
    get cleared() {
      return cleared;
    },
    write: (text) => {
      writes.push(text);
    },
    setInterval: (fn) => {
      ticker = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
      ticker = null;
    },
    tick(n = 1) {
      for (let i = 0; i < n; i++) ticker?.();
    },
    screen() {
      // stop() writes a bare restore sequence after its final paint, so look
      // back to the last write that actually carries text.
      for (let i = writes.length - 1; i >= 0; i--) {
        const painted = (writes[i] ?? "").replace(ANSI, "").trim();
        if (painted) return painted;
      }
      return "";
    },
  };
}

describe("app/startup progress", () => {
  it("paints every step as pending before any work starts", () => {
    const term = fakeTerminal();
    startStartupProgress(STEPS, term);

    const screen = term.screen();
    for (const label of STEPS) assertStringIncludes(screen, label);
    assertStringIncludes(screen, "○");
    assertEquals(screen.includes("✓"), false);
  });

  it("marks earlier steps done as later ones begin", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);

    progress.begin(1);

    const screen = term.screen();
    assertStringIncludes(screen, "✓ Loading configuration");
    assertStringIncludes(screen, "○ Starting server");
  });

  it("never waits on its own, so nothing is painted between steps", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    const beforeWork = term.writes.length;

    // Work that finishes instantly advances instantly.
    progress.begin(0);
    progress.begin(1);
    progress.begin(2);
    progress.finish();

    // One paint per advance, plus the final one. No frame padding.
    assertEquals(term.writes.length - beforeWork, 4);
  });

  it("animates the active step while work is still running", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.begin(2);

    const first = term.screen();
    term.tick();
    const second = term.screen();

    assertEquals(first === second, false, "spinner frame should advance");
    assertStringIncludes(second, "Starting server");
  });

  it("shows every step done and stops the spinner on finish", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.begin(2);
    progress.finish();

    const screen = term.screen();
    for (const label of STEPS) assertStringIncludes(screen, `✓ ${label}`);
    assertEquals(screen.includes("○"), false);
    assertEquals(term.cleared, true);
  });

  it("stops painting once finished", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.finish();
    const afterFinish = term.writes.length;

    term.tick(5);
    progress.begin(1);

    assertEquals(term.writes.length, afterFinish);
  });

  it("does not claim success when startup fails", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.begin(2);

    progress.stop();

    const screen = term.screen();
    // The step that was running must not be reported as done.
    assertEquals(screen.includes("✓ Starting server"), false);
    assertStringIncludes(screen, "✓ Loading configuration");
    assertEquals(term.cleared, true);
  });

  it("restores the terminal when startup fails", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.begin(1);

    progress.stop();

    // The caller rethrows after this, so the error must land on the normal
    // screen with the cursor visible.
    const last = term.writes[term.writes.length - 1] ?? "";
    assertStringIncludes(last, "\x1b[?1049l");
    assertStringIncludes(last, "\x1b[?25h");
  });

  it("leaves the alternate screen on for a successful finish", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.finish();

    // The dashboard takes over in place, so this one must not restore.
    const last = term.writes[term.writes.length - 1] ?? "";
    assertEquals(last.includes("\x1b[?1049l"), false);
  });

  it("stops painting after a failure", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.stop();
    const afterStop = term.writes.length;

    term.tick(3);
    progress.finish();

    assertEquals(term.writes.length, afterStop);
  });

  it("ignores stop() after a successful finish", () => {
    // The start command guards its whole sequence with a catch that calls
    // stop(), including after finish() has already run.
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.finish();
    const afterFinish = term.writes.length;

    progress.stop();

    assertEquals(term.writes.length, afterFinish);
    assertStringIncludes(term.screen(), "✓ Starting server");
  });

  it("is safe to finish twice", () => {
    const term = fakeTerminal();
    const progress = startStartupProgress(STEPS, term);
    progress.finish();
    const afterFirst = term.writes.length;

    progress.finish();

    assertEquals(term.writes.length, afterFirst);
  });
});
