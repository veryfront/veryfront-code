/**
 * Tests for PTY passthrough module
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createPtySession,
  detectInstalledAgents,
  isCommandAvailable,
  parseCommand,
  PtyOptionsSchema,
  PtySessionSchema as _PtySessionSchema,
  PtyStateSchema,
  spawnAgent,
  updatePtySession,
  waitForExit,
} from "./pty.ts";
import type { CodingAgentDef } from "./types.ts";

describe("PtyStateSchema", () => {
  it("validates valid states", () => {
    expect(PtyStateSchema.parse("idle")).toBe("idle");
    expect(PtyStateSchema.parse("running")).toBe("running");
    expect(PtyStateSchema.parse("exited")).toBe("exited");
    expect(PtyStateSchema.parse("error")).toBe("error");
  });

  it("rejects invalid states", () => {
    expect(() => PtyStateSchema.parse("invalid")).toThrow();
  });
});

describe("PtyOptionsSchema", () => {
  it("parses empty options with defaults", () => {
    const result = PtyOptionsSchema.parse({});
    expect(result.inheritEnv).toBe(true);
  });

  it("parses full options", () => {
    const result = PtyOptionsSchema.parse({
      cwd: "/tmp",
      env: { FOO: "bar" },
      inheritEnv: false,
    });

    expect(result.cwd).toBe("/tmp");
    expect(result.env).toEqual({ FOO: "bar" });
    expect(result.inheritEnv).toBe(false);
  });
});

describe("parseCommand", () => {
  it("parses simple command", () => {
    const result = parseCommand("claude");
    expect(result).toEqual(["claude"]);
  });

  it("parses command with args", () => {
    const result = parseCommand("claude --model opus");
    expect(result).toEqual(["claude", "--model", "opus"]);
  });

  it("parses command with quoted strings", () => {
    const result = parseCommand('claude --message "hello world"');
    expect(result).toEqual(["claude", "--message", "hello world"]);
  });

  it("parses command with single quotes", () => {
    const result = parseCommand("echo 'hello world'");
    expect(result).toEqual(["echo", "hello world"]);
  });

  it("handles multiple spaces", () => {
    const result = parseCommand("cmd   arg1   arg2");
    expect(result).toEqual(["cmd", "arg1", "arg2"]);
  });

  it("handles empty string", () => {
    const result = parseCommand("");
    expect(result).toEqual([]);
  });

  it("parses command with path", () => {
    const result = parseCommand("cursor .");
    expect(result).toEqual(["cursor", "."]);
  });
});

describe("createPtySession", () => {
  it("creates idle session", () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "test-cmd",
      provider: "Test",
      type: "cli",
    };

    const session = createPtySession(agent);

    expect(session.id).toBeDefined();
    expect(session.agent).toBe(agent);
    expect(session.state).toBe("idle");
    expect(session.exitCode).toBeNull();
    expect(session.error).toBeNull();
    expect(session.startedAt).toBeNull();
  });
});

describe("updatePtySession", () => {
  it("updates session state", () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "test-cmd",
      provider: "Test",
      type: "cli",
    };

    const session = createPtySession(agent);
    const updated = updatePtySession(session, {
      state: "running",
      startedAt: 12345,
    });

    expect(updated.state).toBe("running");
    expect(updated.startedAt).toBe(12345);
    expect(updated.id).toBe(session.id);
  });

  it("preserves unchanged fields", () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "test-cmd",
      provider: "Test",
      type: "cli",
    };

    const session = createPtySession(agent);
    const updated = updatePtySession(session, { state: "error" });

    expect(updated.exitCode).toBeNull();
    expect(updated.error).toBeNull();
  });
});

describe("spawnAgent", () => {
  it("fails with empty command", () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "",
      provider: "Test",
      type: "cli",
    };

    const result = spawnAgent(agent);

    expect(result.success).toBe(false);
    expect(result.session.state).toBe("error");
    expect(result.error).toContain("empty");
  });

  it("fails with non-existent command", () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "nonexistent-command-xyz123",
      provider: "Test",
      type: "cli",
    };

    const result = spawnAgent(agent);

    expect(result.success).toBe(false);
    expect(result.session.state).toBe("error");
  });

  it("spawns valid command", async () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "echo hello",
      provider: "Test",
      type: "cli",
    };

    const result = spawnAgent(agent);

    expect(result.success).toBe(true);
    expect(result.session.state).toBe("running");
    expect(result.process).toBeDefined();

    // Clean up
    if (result.process) {
      await result.process.status;
    }
  });
});

describe("isCommandAvailable", () => {
  it("returns true for existing command", async () => {
    const result = await isCommandAvailable("echo");
    expect(result).toBe(true);
  });

  it("returns false for non-existent command", async () => {
    const result = await isCommandAvailable("nonexistent-command-xyz123");
    expect(result).toBe(false);
  });

  it("returns false for empty command", async () => {
    const result = await isCommandAvailable("");
    expect(result).toBe(false);
  });
});

describe("detectInstalledAgents", () => {
  it("detects installed agents", async () => {
    const agents: CodingAgentDef[] = [
      { id: "echo", name: "Echo", command: "echo", provider: "Test", type: "cli" },
      { id: "fake", name: "Fake", command: "fake-cmd-xyz", provider: "Test", type: "cli" },
    ];

    const installed = await detectInstalledAgents(agents);

    expect(installed.has("echo")).toBe(true);
    expect(installed.has("fake")).toBe(false);
  });

  it("handles empty list", async () => {
    const installed = await detectInstalledAgents([]);
    expect(installed.size).toBe(0);
  });
});

describe("waitForExit", () => {
  it("waits for process to exit", async () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "echo hello",
      provider: "Test",
      type: "cli",
    };

    const result = spawnAgent(agent);

    expect(result.success).toBe(true);
    expect(result.process).toBeDefined();

    if (result.process) {
      const session = await waitForExit(result.process, result.session);

      expect(session.state).toBe("exited");
      expect(session.exitCode).toBe(0);
    }
  });

  it("captures non-zero exit code", async () => {
    const agent: CodingAgentDef = {
      id: "test",
      name: "Test Agent",
      command: "sh -c 'exit 42'",
      provider: "Test",
      type: "cli",
    };

    const result = spawnAgent(agent);

    expect(result.success).toBe(true);

    if (result.process) {
      const session = await waitForExit(result.process, result.session);

      expect(session.state).toBe("exited");
      expect(session.exitCode).toBe(42);
    }
  });
});
