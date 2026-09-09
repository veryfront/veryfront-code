import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  containsExactArtifactPathValue,
  evaluateSlashCommandArtifactPolicy,
} from "#veryfront/agent/artifacts/slash-command-artifact-policy.ts";

for (const replaceMethods of [false, true]) {
  describe(`private artifact patterns ${replaceMethods ? "hooks" : "baseline"}`, () => {
    it("matches commands and submitted paths without invoking mutable matching or traversal methods", () => {
      const marker = "synthetic-private-artifact";
      const formId = "form-" + marker;
      const messages = [
        { role: "user", content: [{ type: "text", text: `/plan ${marker}` }] },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "load", toolName: "load_skill" },
            { type: "tool-call", toolCallId: formId, toolName: "form_input" },
          ],
        },
        {
          role: "tool",
          toolCallId: formId,
          content: JSON.stringify({ values: { path: `/plans/${marker}.md` } }),
        },
      ];
      const test = RegExp.prototype.test;
      const exec = RegExp.prototype.exec;
      const includes = String.prototype.includes;
      const trim = String.prototype.trim;
      const flatMap = Array.prototype.flatMap;
      const isArray = Array.isArray;
      const values = Object.values;
      const parse = JSON.parse;
      const set = Map.prototype.set;
      const stringify = JSON.stringify;
      const apply = Reflect.apply;
      let observations = 0;
      const observe = (value: unknown) => {
        const text = typeof value === "string" ? value : stringify(value) ?? "";
        if (apply(includes, text, [marker])) observations++;
      };
      let policy: ReturnType<typeof evaluateSlashCommandArtifactPolicy> | undefined;
      let submittedPath = false;
      try {
        if (replaceMethods) {
          String.prototype.trim = function () {
            observe(this);
            return apply(trim, this, []);
          };
          Array.prototype.flatMap = (function (this: unknown[], ...args: unknown[]) {
            observe(this);
            return apply(flatMap, this, args);
          }) as typeof flatMap;
          Array.isArray = function (value): value is unknown[] {
            observe(value);
            return isArray(value);
          };
          Object.values = function (value: unknown) {
            observe(value);
            return apply(values, undefined, [value]);
          };
          JSON.parse = function (text, reviver) {
            observe(text);
            return parse(text, reviver);
          };
          Map.prototype.set = function (key, value) {
            observe(key);
            observe(value);
            return apply(set, this, [key, value]);
          };
          RegExp.prototype.test = function (input) {
            if (typeof input === "string" && apply(includes, input, [marker])) observations++;
            return apply(test, this, [input]);
          };
          RegExp.prototype.exec = function (input) {
            if (typeof input === "string" && apply(includes, input, [marker])) observations++;
            return apply(exec, this, [input]);
          };
        }
        policy = evaluateSlashCommandArtifactPolicy({ messages });
        submittedPath = containsExactArtifactPathValue({
          values: { paths: [`/plans/${marker}.md`] },
        });
      } finally {
        if (replaceMethods) {
          String.prototype.trim = trim;
          Array.prototype.flatMap = flatMap;
          Array.isArray = isArray;
          Object.values = values;
          JSON.parse = parse;
          Map.prototype.set = set;
          RegExp.prototype.test = test;
          RegExp.prototype.exec = exec;
        }
      }
      assertEquals(policy, {
        hasSlashCommand: true,
        hasExactArtifactPath: true,
        hasLoadSkill: true,
        hasInvokeAgent: false,
        shouldKeepReminder: true,
      });
      assertEquals(submittedPath, true);
      assertEquals(observations, 0);
    });
  });
}
