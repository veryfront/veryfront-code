
import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { branch, unless, when } from "./branch.ts";
import { step } from "./step.ts";
import type { BranchNodeConfig } from "../types.ts";

describe("branch()", () => {
  it("should create a branch node with then/else", () => {
    const node = branch("check", {
      condition: () => true,
      then: [step("yes", { agent: "a" })],
      else: [step("no", { agent: "b" })],
    });

    assertEquals(node.id, "check");
    assertEquals(node.config.type, "branch");

    const config = node.config as BranchNodeConfig;
    assertEquals(typeof config.condition, "function");
    assertEquals(config.then?.length, 1);
    assertEquals(config.else?.length, 1);
  });

  it("should work without else branch", () => {
    const node = branch("optional", {
      condition: () => true,
      then: [step("do-it", { agent: "a" })],
    });

    const config = node.config as BranchNodeConfig;
    assertEquals(config.then?.length, 1);
    assertEquals(config.else, undefined);
  });

  it("should support multiple steps in branches", () => {
    const node = branch("multi", {
      condition: () => true,
      then: [
        step("step1", { agent: "a" }),
        step("step2", { agent: "b" }),
        step("step3", { agent: "c" }),
      ],
      else: [
        step("alt1", { agent: "x" }),
        step("alt2", { agent: "y" }),
      ],
    });

    const config = node.config as BranchNodeConfig;
    assertEquals(config.then?.length, 3);
    assertEquals(config.else?.length, 2);
  });

  it("should support async conditions", () => {
    const node = branch("async-check", {
      condition: async () => {
        await Promise.resolve();
        return true;
      },
      then: [step("async-step", { agent: "a" })],
    });

    const config = node.config as BranchNodeConfig;
    assertEquals(typeof config.condition, "function");
  });
});

describe("when()", () => {
  it("should be a convenience wrapper for branch with only then", () => {
    const node = when(
      "if-premium",
      () => true,
      [step("premium-feature", { agent: "premium" })],
    );

    assertEquals(node.id, "if-premium");
    assertEquals(node.config.type, "branch");

    const config = node.config as BranchNodeConfig;
    assertEquals(config.then?.length, 1);
    assertEquals(config.else, undefined);
  });
});

describe("unless()", () => {
  it("should be a convenience wrapper for inverted condition", () => {
    const node = unless(
      "unless-disabled",
      () => false,
      [step("enabled-feature", { agent: "a" })],
    );

    assertEquals(node.id, "unless-disabled");
    assertEquals(node.config.type, "branch");

    const config = node.config as BranchNodeConfig;
    assertEquals(config.then?.length, 1);
  });

  it("should invert the condition", async () => {
    let originalConditionValue = false;
    const node = unless(
      "test",
      () => originalConditionValue,
      [step("a", { agent: "a" })],
    );

    const config = node.config as BranchNodeConfig;
    const result = await config.condition({} as never);
    assertEquals(result, true);

    originalConditionValue = true;
    const node2 = unless(
      "test2",
      () => originalConditionValue,
      [step("b", { agent: "b" })],
    );
    const config2 = node2.config as BranchNodeConfig;
    const result2 = await config2.condition({} as never);
    assertEquals(result2, false);
  });
});
