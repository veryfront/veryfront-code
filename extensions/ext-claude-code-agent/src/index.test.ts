import { assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import {
  type ClaudeCodeAgentRuntime,
  ClaudeCodeAgentRuntimeName,
} from "veryfront/workflow/claude-code/runtime";
import factory from "./index.ts";

const logger: ExtensionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function context(provided: Map<string, unknown>): ExtensionContext {
  return {
    config: {},
    logger,
    get: <T>(name: string) => provided.get(name) as T | undefined,
    require: <T>(name: string) => {
      const value = provided.get(name);
      if (value === undefined) throw new Error(`missing ${name}`);
      return value as T;
    },
    provide: <T>(name: string, value: T) => {
      provided.set(name, value);
    },
  };
}

describe("ext-claude-code-agent", () => {
  it("declares its privileged capabilities and runtime contract", () => {
    const extension = factory();
    assertEquals(extension.name, "ext-claude-code-agent");
    assertEquals(extension.contracts?.provides, [ClaudeCodeAgentRuntimeName]);
    assertEquals(extension.capabilities, [
      { type: "fs:read" },
      { type: "fs:write" },
      { type: "env:read" },
      { type: "net:outbound", hosts: ["*"] },
      { type: "process:spawn" },
    ]);
  });

  it("registers one SDK runtime and supports teardown", async () => {
    const provided = new Map<string, unknown>();
    const extension = factory();

    await extension.setup?.(context(provided));

    const runtime = provided.get(ClaudeCodeAgentRuntimeName) as
      | ClaudeCodeAgentRuntime
      | undefined;
    assertExists(runtime);
    assertEquals(typeof runtime.execute, "function");
    await assertRejects(
      async () => await extension.setup?.(context(provided)),
      Error,
      "already set up",
    );

    await extension.teardown?.();
    await extension.setup?.(context(provided));
  });

  it("rejects ignored extension configuration", () => {
    assertThrows(
      () => factory({ model: "hardcoded-model" }),
      TypeError,
      "does not accept extension configuration",
    );
  });
});
