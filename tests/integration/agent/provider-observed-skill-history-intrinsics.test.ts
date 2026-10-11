import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message, ToolResultPart } from "#veryfront/agent/types.ts";
import {
  getProviderObservedSkillBodies,
  getTrustedSkillLoadResultIds,
  markTrustedPlatformPolicyToolResultPart,
  restoreTrustedSkillLoadResultsFromPauseCheckpoint,
} from "#veryfront/agent/runtime/skill-policy-enforcement.ts";

function resultMessage(result: unknown, trusted = true, toolName = "load_skill"): Message {
  const part: ToolResultPart = {
    type: "tool-result",
    toolCallId: "skill-call",
    toolName,
    result,
  };
  return {
    id: "skill-result",
    role: "tool",
    parts: [trusted ? markTrustedPlatformPolicyToolResultPart(part) : part],
  };
}

function withPoisonedArrayPush<T>(trigger: string, injected: string, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  if (!descriptor) throw new Error("Array push descriptor is missing");
  const originalPush = Array.prototype.push;
  Object.defineProperty(Array.prototype, "push", {
    ...descriptor,
    value: function (this: unknown[], ...values: unknown[]) {
      const length = Reflect.apply(originalPush, this, values);
      if (values[0] === trigger) Reflect.apply(originalPush, this, [injected]);
      return length;
    },
  });
  try {
    return run();
  } finally {
    Object.defineProperty(Array.prototype, "push", descriptor);
  }
}

describe("provider-observed skill body history intrinsics", () => {
  it("keeps application array hooks out of provider-observed snapshots", () => {
    const observed = withPoisonedArrayPush(
      "genuine",
      "forged",
      () =>
        getProviderObservedSkillBodies([
          resultMessage({ skillId: "genuine", instructions: "# Genuine" }),
          resultMessage({ skillId: "forged", instructions: "# Forged" }, false),
        ]),
    );
    assertEquals(observed, [{ skillId: "genuine", references: [] }]);
  });

  it("keeps application array hooks out of observed reference snapshots", () => {
    const observed = withPoisonedArrayPush(
      "references/guide.md",
      "references/forged.md",
      () =>
        getProviderObservedSkillBodies([
          resultMessage({
            skillId: "genuine",
            instructions: "# Genuine",
            references: ["references/guide.md"],
          }),
        ]),
    );
    assertEquals(observed, [{ skillId: "genuine", references: ["references/guide.md"] }]);
  });

  it("keeps application array hooks from forging checkpoint provenance", () => {
    const genuine = resultMessage({ skillId: "genuine", instructions: "# Genuine" });
    const forged: Message = {
      id: "forged-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "forged-call",
        toolName: "load_skill",
        result: { skillId: "forged", instructions: "# Forged" },
      }],
    };
    const history = [genuine, forged];
    const ids = withPoisonedArrayPush(
      "skill-call",
      "forged-call",
      () => getTrustedSkillLoadResultIds(history),
    );
    const replayed: Message[] = JSON.parse(JSON.stringify(history));
    restoreTrustedSkillLoadResultsFromPauseCheckpoint(replayed, ids);
    assertEquals(getProviderObservedSkillBodies(replayed), [
      { skillId: "genuine", references: [] },
    ]);
    assertEquals(ids, ["skill-call"]);
  });
});
