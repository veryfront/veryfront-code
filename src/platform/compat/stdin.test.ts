/**
 * Stdin utilities tests
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEscapeBuffer } from "./stdin.ts";

describe("createEscapeBuffer", () => {
  it("should pass through regular characters immediately", () => {
    const timeouts: string[] = [];
    const buffer = createEscapeBuffer((key) => timeouts.push(key));

    assertEquals(buffer.push("a"), "a");
    assertEquals(buffer.push("b"), "b");
    assertEquals(buffer.push("1"), "1");
    assertEquals(timeouts, []);

    buffer.clear();
  });

  it("should buffer escape and combine with following input", () => {
    const timeouts: string[] = [];
    const buffer = createEscapeBuffer((key) => timeouts.push(key));

    // Escape alone returns null (buffered)
    assertEquals(buffer.push("\x1b"), null);

    // Next input combines with buffered escape
    assertEquals(buffer.push("[A"), "\x1b[A");
    assertEquals(timeouts, []);

    buffer.clear();
  });

  it("should pass through complete escape sequences", () => {
    const timeouts: string[] = [];
    const buffer = createEscapeBuffer((key) => timeouts.push(key));

    // Complete sequence in one read
    assertEquals(buffer.push("\x1b[A"), "\x1b[A");
    assertEquals(buffer.push("\x1b[B"), "\x1b[B");
    assertEquals(timeouts, []);

    buffer.clear();
  });

  it("should timeout standalone escape key", async () => {
    const timeouts: string[] = [];
    const buffer = createEscapeBuffer((key) => timeouts.push(key));

    // Escape alone
    assertEquals(buffer.push("\x1b"), null);

    // Wait for timeout (50ms + buffer)
    await new Promise((r) => setTimeout(r, 100));

    assertEquals(timeouts, ["\x1b"]);

    buffer.clear();
  });

  it("should clear pending escape", () => {
    const timeouts: string[] = [];
    const buffer = createEscapeBuffer((key) => timeouts.push(key));

    assertEquals(buffer.push("\x1b"), null);
    buffer.clear();

    // After clear, next input is fresh
    assertEquals(buffer.push("a"), "a");
    assertEquals(timeouts, []);
  });
});
