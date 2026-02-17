/**
 * Tests for the browser inference Worker script's extractText logic.
 *
 * The actual extractText function is embedded in WORKER_SCRIPT as a string,
 * so we evaluate the function independently to verify its behavior with
 * both string and chat-format (array of message objects) generated_text.
 */

import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";

// Mirror of the extractText function from WORKER_SCRIPT.
// Keep in sync with worker-script.ts.
// deno-lint-ignore no-explicit-any
function extractText(generated: any): string {
  if (typeof generated === "string") return generated;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return last?.content ?? "";
  }
  return "";
}

describe("worker extractText", () => {
  it("returns plain string as-is", () => {
    assertEquals(extractText("Hello world"), "Hello world");
  });

  it("extracts last message content from chat-format array", () => {
    const chatOutput = [
      { role: "assistant", content: "Hello! How can I help?" },
    ];
    assertEquals(extractText(chatOutput), "Hello! How can I help?");
  });

  it("extracts last message from multi-message array", () => {
    const chatOutput = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hey there!" },
    ];
    assertEquals(extractText(chatOutput), "Hey there!");
  });

  it("returns empty string for empty array", () => {
    assertEquals(extractText([]), "");
  });

  it("returns empty string for null/undefined", () => {
    assertEquals(extractText(null), "");
    assertEquals(extractText(undefined), "");
  });

  it("returns empty string when last message has no content", () => {
    assertEquals(extractText([{ role: "assistant" }]), "");
  });
});
