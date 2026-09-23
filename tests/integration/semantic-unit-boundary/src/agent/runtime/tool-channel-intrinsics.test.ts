// Mutates Set.prototype, so it belongs in the semantic integration suite
// rather than a hermetic unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getToolChannelProfile,
  recoverTextEmittedToolCalls,
} from "#veryfront/agent/runtime/tool-channel.ts";

describe("tool-channel provider policy intrinsic boundary", () => {
  it("uses the captured Set intrinsic for provider policy lookups", () => {
    const originalHas = Set.prototype.has;
    Object.defineProperty(Set.prototype, "has", {
      configurable: true,
      value: () => true,
    });
    try {
      const profile = getToolChannelProfile("deepseek/deepseek-v3");
      assertEquals(profile.forceByDefault, false);
      assertEquals(profile.recoverTextToolCalls, false);
    } finally {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: originalHas,
      });
    }
  });

  it("uses captured string and array intrinsics for provider parsing", () => {
    const originalSplit = String.prototype.split;
    const originalFilter = Array.prototype.filter;
    Object.defineProperty(String.prototype, "split", {
      configurable: true,
      value: () => ["mistral", "spoofed"],
    });
    Object.defineProperty(Array.prototype, "filter", {
      configurable: true,
      value: () => ["mistral", "spoofed"],
    });
    try {
      const profile = getToolChannelProfile("deepseek/deepseek-v3");
      assertEquals(profile.forceByDefault, false);
      assertEquals(profile.recoverTextToolCalls, false);
    } finally {
      Object.defineProperty(String.prototype, "split", {
        configurable: true,
        value: originalSplit,
      });
      Object.defineProperty(Array.prototype, "filter", {
        configurable: true,
        value: originalFilter,
      });
    }
  });

  it("uses captured set and array intrinsics for recovery classification", () => {
    const originalHas = Set.prototype.has;
    const originalIncludes = Array.prototype.includes;
    Object.defineProperty(Set.prototype, "has", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(Array.prototype, "includes", {
      configurable: true,
      value: () => true,
    });
    try {
      assertEquals(
        recoverTextEmittedToolCalls(
          '{"name":"delete_file","arguments":{}}',
          new Set(["get_file"]),
          () => "call-test",
        ),
        undefined,
      );
    } finally {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: originalHas,
      });
      Object.defineProperty(Array.prototype, "includes", {
        configurable: true,
        value: originalIncludes,
      });
    }
  });
});
