import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_DEV_PORT,
  DEFAULT_PADDING_X,
  DEFAULT_PADDING_Y,
  DEFAULT_PROGRESS_BAR_WIDTH,
  DEFAULT_PROXY_PORT,
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
  DURATION_MINUTES_THRESHOLD_MS,
  DURATION_SECONDS_THRESHOLD_MS,
  RENDER_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  SPINNER_INTERVAL_MS,
  TYPEWRITER_CHAR_DELAY_MS,
  TYPEWRITER_WORD_DELAY_MS,
} from "./constants.ts";

describe("cli/ui/constants", () => {
  it("should have correct port defaults", () => {
    assertEquals(DEFAULT_DEV_PORT, 3000);
    assertEquals(DEFAULT_PROXY_PORT, 8080);
  });

  it("should have correct timing constants", () => {
    assertEquals(SPINNER_INTERVAL_MS, 80);
    assertEquals(RENDER_INTERVAL_MS, 100);
    assertEquals(SHUTDOWN_TIMEOUT_MS, 3000);
    assertEquals(TYPEWRITER_CHAR_DELAY_MS, 30);
    assertEquals(TYPEWRITER_WORD_DELAY_MS, 100);
  });

  it("should have correct layout constants", () => {
    assertEquals(DEFAULT_PADDING_X, 2);
    assertEquals(DEFAULT_PADDING_Y, 1);
    assertEquals(DEFAULT_PROGRESS_BAR_WIDTH, 20);
    assertEquals(DEFAULT_TERMINAL_WIDTH, 80);
    assertEquals(DEFAULT_TERMINAL_HEIGHT, 24);
  });

  it("should have correct duration thresholds", () => {
    assertEquals(DURATION_SECONDS_THRESHOLD_MS, 1000);
    assertEquals(DURATION_MINUTES_THRESHOLD_MS, 60000);
  });
});
