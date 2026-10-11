import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  rejectsOpenAISamplingParams,
  resolveOpenAIReasoningConfig,
  shouldRequestOpenAIReasoningSummary,
} from "#veryfront/provider/shared/openai-reasoning.ts";

describe("OpenAI reasoning classifier intrinsic boundaries", () => {
  it("keeps default reasoning classification when string, regex, and numeric intrinsics are replaced", () => {
    const nativeToLowerCase = String.prototype.toLowerCase;
    const nativeTest = RegExp.prototype.test;
    const nativeExec = RegExp.prototype.exec;
    const nativeParseInt = Number.parseInt;
    const replacements = [
      {
        toLowerCase() {
          throw new Error("poisoned String.prototype.toLowerCase");
        },
        test() {
          throw new Error("poisoned RegExp.prototype.test");
        },
        exec() {
          throw new Error("poisoned RegExp.prototype.exec");
        },
        parseInt() {
          throw new Error("poisoned Number.parseInt");
        },
      },
      {
        toLowerCase() {
          return "not-openai";
        },
        test() {
          return false;
        },
        exec() {
          return null;
        },
        parseInt() {
          return 1;
        },
      },
    ] satisfies Array<{
      readonly toLowerCase: typeof String.prototype.toLowerCase;
      readonly test: typeof RegExp.prototype.test;
      readonly exec: typeof RegExp.prototype.exec;
      readonly parseInt: typeof Number.parseInt;
    }>;

    try {
      for (const replacement of replacements) {
        String.prototype.toLowerCase = replacement.toLowerCase;
        RegExp.prototype.test = replacement.test;
        RegExp.prototype.exec = replacement.exec;
        Number.parseInt = replacement.parseInt;

        const defaultReasoning = resolveOpenAIReasoningConfig(
          "GPT-5.4-NANO",
          "Veryfront-Cloud",
          undefined,
        );
        assertEquals(defaultReasoning, { effort: "medium", source: "default" });
        if (defaultReasoning === undefined) {
          throw new Error("expected default OpenAI reasoning");
        }
        assertEquals(
          shouldRequestOpenAIReasoningSummary("Veryfront-Cloud", defaultReasoning),
          true,
        );
        assertEquals(rejectsOpenAISamplingParams("GPT-5.4-NANO"), true);
        assertEquals(
          resolveOpenAIReasoningConfig("GPT-5.1", "OpenAI", undefined),
          undefined,
        );
      }
    } finally {
      String.prototype.toLowerCase = nativeToLowerCase;
      RegExp.prototype.test = nativeTest;
      RegExp.prototype.exec = nativeExec;
      Number.parseInt = nativeParseInt;
    }
  });
});
