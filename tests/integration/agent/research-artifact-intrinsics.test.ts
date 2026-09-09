import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applyDefaultResearchArtifactPath,
  type DefaultResearchArtifactContext,
  shouldRetryCreateResearchArtifactAsUpdate,
  updateDefaultResearchArtifacts,
} from "#veryfront/agent/artifacts/default-research-artifact-support.ts";

describe("private research artifact inputs", () => {
  for (
    const [prototype, method] of [
      [String.prototype, "replace"],
      [String.prototype, "match"],
      [String.prototype, "trim"],
      [String.prototype, "toLowerCase"],
      [String.prototype, "startsWith"],
      [String.prototype, "endsWith"],
      [RegExp.prototype, "test"],
      [RegExp.prototype, "exec"],
      [RegExp.prototype, Symbol.replace],
    ] as const
  ) {
    it(`keeps conversation text and tool paths out of replaced ${String(method)}`, () => {
      const marker = "synthetic-private-research";
      const prompt = `/research ${marker} and save findings to the project`;
      const context: DefaultResearchArtifactContext = { parentRunId: "synthetic-run" };
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method)!;
      const apply = Reflect.apply;
      const includes = String.prototype.includes;
      let observations = 0;
      let system;
      let toolInput;
      let retry;
      try {
        Object.defineProperty(prototype, method, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            if (typeof this === "string" && apply(includes, this, [marker])) observations++;
            if (typeof args[0] === "string" && apply(includes, args[0], [marker])) observations++;
            return apply(descriptor.value, this, args);
          },
        });
        system = updateDefaultResearchArtifacts({
          taskContext: context,
          latestUserText: prompt,
          system: "Base instructions",
        });
        toolInput = applyDefaultResearchArtifactPath("create_file", {
          path: `/${marker}/report.md`,
          content: "Synthetic report",
        }, context);
        retry = shouldRetryCreateResearchArtifactAsUpdate({
          toolName: "create_file",
          toolInput: {
            path: context.defaultResearchArtifacts!.currentReportPath,
            content: "Synthetic report",
          },
          taskContext: context,
          error: {
            isError: true,
            content: [{ type: "text", text: `File already exists: ${marker}.md` }],
          },
        });
      } finally {
        Object.defineProperty(prototype, method, descriptor);
      }
      assertStringIncludes(String(system), `/research/${marker}/report.md`);
      assertEquals(toolInput?.path, `research/${marker}/report.md`);
      assertEquals(retry, true);
      assertEquals(observations, 0);
    });
  }
});
