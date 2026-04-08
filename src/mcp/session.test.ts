import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SessionManager } from "./session.ts";

describe("mcp/session", () => {
  it("creates a session and returns a cryptographically secure ID", () => {
    const manager = new SessionManager();
    const id = manager.create();
    assertExists(id);
    assertEquals(typeof id, "string");
    assertEquals(id.length > 16, true); // UUIDs are 36 chars
  });

  it("validates an active session", () => {
    const manager = new SessionManager();
    const id = manager.create();
    assertEquals(manager.isValid(id), true);
  });

  it("rejects unknown session IDs", () => {
    const manager = new SessionManager();
    assertEquals(manager.isValid("nonexistent"), false);
  });

  it("terminates a session", () => {
    const manager = new SessionManager();
    const id = manager.create();
    manager.terminate(id);
    assertEquals(manager.isValid(id), false);
  });

  it("session IDs contain only visible ASCII", () => {
    const manager = new SessionManager();
    const id = manager.create();
    assertEquals(/^[\x21-\x7E]+$/.test(id), true);
  });
});
