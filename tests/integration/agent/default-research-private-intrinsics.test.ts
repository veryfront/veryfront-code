import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applyDefaultResearchArtifactPath,
  type DefaultResearchArtifactContext,
  shouldRetryCreateResearchArtifactAsUpdate,
  updateDefaultResearchArtifacts,
} from "#veryfront/agent/artifacts/default-research-artifact-support.ts";

for (const hooks of [false, true]) {
  describe(`private research normalization ${hooks ? "hooks" : "baseline"}`, () => {
    it("keeps prompt and model paths private while preserving research routing", () => {
      const marker = "synthetic-private-research";
      const prompt =
        `<span data-command="research">/research</span> Research ${marker} and save findings to the project.`;
      const context: DefaultResearchArtifactContext = { parentRunId: "run-one" };
      const test = RegExp.prototype.test;
      const exec = RegExp.prototype.exec;
      const replaceRegExp = RegExp.prototype[Symbol.replace];
      const replace = String.prototype.replace;
      const trim = String.prototype.trim;
      const lower = String.prototype.toLowerCase;
      const startsWith = String.prototype.startsWith;
      const endsWith = String.prototype.endsWith;
      const match = String.prototype.match;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      const observe = (value: unknown) => {
        if (typeof value === "string" && apply(includes, value, [marker])) observations++;
      };
      let system: ReturnType<typeof updateDefaultResearchArtifacts> = "";
      let normalized: Record<string, unknown> = {};
      let retry = false;
      try {
        if (hooks) {
          RegExp.prototype.test = function (input) {
            observe(input);
            return apply(test, this, [input]);
          };
          RegExp.prototype.exec = function (input) {
            observe(input);
            return apply(exec, this, [input]);
          };
          RegExp.prototype[Symbol.replace] = function (
            input: string,
            replacement: string | ((substring: string, ...args: unknown[]) => string),
          ) {
            observe(input);
            return apply(replaceRegExp, this, [input, replacement]);
          };
          String.prototype.replace = function (...args) {
            observe(this);
            return apply(replace, this, args);
          };
          String.prototype.trim = function () {
            observe(this);
            return apply(trim, this, []);
          };
          String.prototype.toLowerCase = function () {
            observe(this);
            return apply(lower, this, []);
          };
          String.prototype.startsWith = function (...args) {
            observe(this);
            return apply(startsWith, this, args);
          };
          String.prototype.endsWith = function (...args) {
            observe(this);
            return apply(endsWith, this, args);
          };
          String.prototype.match = function (...args) {
            observe(this);
            return apply(match, this, args);
          };
        }
        system = updateDefaultResearchArtifacts({
          taskContext: context,
          latestUserText: prompt,
          system: "Base instructions",
        });
        normalized = applyDefaultResearchArtifactPath("create_file", {
          path: `/research/${marker}.md`,
          content: "Synthetic report",
        }, context);
        retry = shouldRetryCreateResearchArtifactAsUpdate({
          toolName: "create_file",
          toolInput: normalized,
          taskContext: context,
          error: { code: "ALREADY_EXISTS", message: "File already exists" },
        });
      } finally {
        if (hooks) {
          RegExp.prototype.test = test;
          RegExp.prototype.exec = exec;
          RegExp.prototype[Symbol.replace] = replaceRegExp;
          String.prototype.replace = replace;
          String.prototype.trim = trim;
          String.prototype.toLowerCase = lower;
          String.prototype.startsWith = startsWith;
          String.prototype.endsWith = endsWith;
          String.prototype.match = match;
        }
      }
      assertEquals(context.defaultResearchArtifacts?.topicSlug, marker);
      assertEquals(normalized.path, `research/${marker}/report.md`);
      assertStringIncludes(
        typeof system === "string" ? system : "",
        `/research/${marker}/runs/run-one.report.md`,
      );
      assertEquals(retry, true);
      assertEquals(observations, 0);
    });
  });
}
