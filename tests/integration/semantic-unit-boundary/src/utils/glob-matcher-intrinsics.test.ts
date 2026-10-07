/**
 * Runs shared glob matching under poisoned built-ins.
 *
 * Agent-authored selectors use this matcher to apply allow and deny glob
 * rules. A served project can replace String or Map prototype methods before
 * selector evaluation, so wildcard authorization must use captured intrinsics.
 * Prototype replacement is a process-global effect, so this lives in the
 * semantic integration suite.
 */
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveSkillSelector } from "#veryfront/skill/selector.ts";
import { globMatches } from "#veryfront/utils/glob-matcher.ts";

describe("glob matcher intrinsic boundary", () => {
  it("keeps glob semantics and selector exclusions under mutable built-ins", () => {
    const startsWithDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "startsWith");
    const charAtDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "charAt");
    const mapGetDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "get");
    const mapSetDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "set");
    if (!startsWithDescriptor || !charAtDescriptor || !mapGetDescriptor || !mapSetDescriptor) {
      throw new Error("expected built-in descriptors");
    }

    try {
      Object.defineProperty(String.prototype, "startsWith", {
        ...startsWithDescriptor,
        value: () => false,
      });
      Object.defineProperty(String.prototype, "charAt", {
        ...charAtDescriptor,
        value: () => "/",
      });
      Object.defineProperty(Map.prototype, "get", {
        ...mapGetDescriptor,
        value: () => {
          throw new Error("poisoned Map.prototype.get");
        },
      });
      Object.defineProperty(Map.prototype, "set", {
        ...mapSetDescriptor,
        value: () => {
          throw new Error("poisoned Map.prototype.set");
        },
      });

      if (!globMatches("support-*", "support-internal")) {
        throw new Error("expected wildcard match under poisoned intrinsics");
      }
      if (!globMatches("knowledge/**/login.md", "knowledge/public/login.md")) {
        throw new Error("expected globstar match under poisoned intrinsics");
      }
      if (globMatches("knowledge/*.md", "knowledge/public/login.md")) {
        throw new Error("expected segment wildcard to stay path-segment bounded");
      }

      const snapshot = resolveSkillSelector({
        definitions: [{ id: "support-internal" }],
        selector: {
          "support-internal": true,
          "support-*": false,
        },
        getId: (definition) => definition.id,
        isVisible: () => true,
      });
      if (snapshot.allowedSkillIds.length !== 0) {
        throw new Error("expected deny glob to override exact allow under poisoned intrinsics");
      }
    } finally {
      Object.defineProperty(String.prototype, "startsWith", startsWithDescriptor);
      Object.defineProperty(String.prototype, "charAt", charAtDescriptor);
      Object.defineProperty(Map.prototype, "get", mapGetDescriptor);
      Object.defineProperty(Map.prototype, "set", mapSetDescriptor);
    }
  });
});
