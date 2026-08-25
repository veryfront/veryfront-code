import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SessionManager } from "./session.ts";

describe("mcp/session", () => {
  it("creates a session and returns a cryptographically secure ID", () => {
    const manager = new SessionManager();
    const id = manager.create();
    assertExists(id);
    assertEquals(typeof id, "string");
    assertEquals(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        .test(id),
      true,
      "session id must be a random v4 UUID",
    );

    const ids = new Set<string>([id]);
    for (const source of [manager, new SessionManager()]) {
      for (let index = 0; index < 200; index++) ids.add(source.create());
    }
    assertEquals(
      ids.size,
      401,
      "session ids must never repeat or follow a per-manager sequence",
    );
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

  it("reports size of active sessions", () => {
    const manager = new SessionManager();
    assertEquals(manager.size, 0);
    const id1 = manager.create();
    assertEquals(manager.size, 1);
    manager.create();
    assertEquals(manager.size, 2);
    manager.terminate(id1);
    assertEquals(manager.size, 1);
  });

  it("clears all sessions", () => {
    const manager = new SessionManager();
    manager.create();
    manager.create();
    assertEquals(manager.size, 2);
    manager.clear();
    assertEquals(manager.size, 0);
  });

  it("session IDs contain only visible ASCII", () => {
    const manager = new SessionManager();
    const id = manager.create();
    assertEquals(/^[\x21-\x7E]+$/.test(id), true);
  });

  it("expires sessions after the inactivity TTL", () => {
    let clock = 1_000;
    const manager = new SessionManager({ ttlMs: 5_000, now: () => clock });
    const id = manager.create();
    assertEquals(manager.requiresSessionHeader(), true);
    assertEquals(manager.isValid(id), true);

    clock += 6_000; // advance past the TTL
    assertEquals(manager.isValid(id), false);
    assertEquals(manager.size, 0); // pruned, not leaked
    assertEquals(manager.requiresSessionHeader(), true);
  });

  it("refreshes the inactivity window on access", () => {
    let clock = 1_000;
    const manager = new SessionManager({ ttlMs: 5_000, now: () => clock });
    const id = manager.create();

    clock += 4_000;
    assertEquals(manager.isValid(id), true); // touch refreshes lastSeen
    clock += 4_000; // 8s since create, but only 4s since last access
    assertEquals(manager.isValid(id), true);
  });

  it("resets the session header requirement after explicit termination", () => {
    const manager = new SessionManager();
    const id = manager.create();
    assertEquals(manager.requiresSessionHeader(), true);

    manager.terminate(id);
    assertEquals(manager.requiresSessionHeader(), false);
  });

  it("keeps the session header required while other sessions are active", () => {
    const manager = new SessionManager();
    const first = manager.create();
    const second = manager.create();

    manager.terminate(first);
    assertEquals(
      manager.requiresSessionHeader(),
      true,
      "the session header stays required while another session is still active",
    );

    manager.terminate(second);
    assertEquals(
      manager.requiresSessionHeader(),
      false,
      "the session header requirement clears once the last session is terminated",
    );
  });
});
