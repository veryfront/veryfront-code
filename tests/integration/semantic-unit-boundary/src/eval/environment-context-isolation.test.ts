import "#veryfront/schemas/_test-setup.ts";
/**
 * An eval's `environmentContext` is read and measured the same way however
 * project code has changed the realm. These tests replace `JSON.stringify` and
 * extend `Object.prototype`, so they live outside the hermetic unit suite.
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEvalSourceDocument, datasets, evalAgent, isEvalDefinition } from "veryfront/eval";
import { createEvalDatasetMetadata } from "../../../../../src/eval/report.ts";
import { getInternalAgentStudioRunContext } from "../../../../../src/internal-agents/run-system-prompt.ts";

describe("eval environment context in a modified realm", () => {
  it("holds the environment context size limit when project code replaces JSON.stringify", () => {
    const oversized = "a".repeat(131_071);
    const originalStringify = JSON.stringify;
    try {
      // An eval module can replace the global while it calls evalAgent.
      JSON.stringify = () => '""';
      assertThrows(
        () =>
          evalAgent({
            target: "agent:researcher",
            dataset: [{ id: "q1", input: "hi" }],
            environmentContext: oversized,
          }),
        Error,
        "Eval environmentContext must be at most 131072 bytes as JSON",
      );
    } finally {
      JSON.stringify = originalStringify;
    }
  });

  it("checks for a blank context without calling a replaced String.prototype.trim", () => {
    const definition = evalAgent({
      target: "agent:researcher",
      dataset: [{ id: "q1", input: "hi" }],
      environmentContext: "active tab: app/page.tsx",
    });
    const originalTrim = String.prototype.trim;
    try {
      // Project code can key the replacement off the context text alone.
      String.prototype.trim = function (this: string) {
        const text = String(this);
        return text.startsWith("active tab") ? "" : originalTrim.call(text);
      };
      assertEquals(isEvalDefinition(definition), true);
      assertEquals(
        evalAgent({
          target: "agent:researcher",
          dataset: [{ id: "q1", input: "hi" }],
          environmentContext: "active tab: app/page.tsx",
        }).environmentContext,
        "active tab: app/page.tsx",
      );
    } finally {
      String.prototype.trim = originalTrim;
    }
  });

  it("reads the generated Studio context item without calling a replaced trim", () => {
    const originalTrim = String.prototype.trim;
    try {
      String.prototype.trim = function (this: string) {
        const text = String(this);
        return text.startsWith("active tab") ? "" : originalTrim.call(text);
      };
      assertEquals(
        getInternalAgentStudioRunContext(
          [
            {
              type: "json",
              title: "studio_context",
              data: { environmentContext: "active tab: app/page.tsx" },
            },
          ] as Parameters<typeof getInternalAgentStudioRunContext>[0],
        ).environmentContext,
        "active tab: app/page.tsx",
      );
    } finally {
      String.prototype.trim = originalTrim;
    }
  });

  it("does not accept a definition mutated to hold an oversized or inherited context", () => {
    const definition = evalAgent({
      target: "agent:researcher",
      dataset: [{ id: "q1", input: "hi" }],
      environmentContext: "active tab: app/page.tsx",
    });
    assertEquals(isEvalDefinition(definition), true);
    assertEquals(
      isEvalDefinition({ ...definition, environmentContext: "a".repeat(131_071) }),
      false,
    );

    // A polluted prototype is not the definition's own context, and must not
    // make every eval in the project invalid.
    const plain = evalAgent({ target: "agent:researcher", dataset: [{ id: "q1", input: "hi" }] });
    const objectPrototype = Object.prototype as Record<string, unknown>;
    objectPrototype.environmentContext = 3;
    try {
      assertEquals(isEvalDefinition(plain), true);
    } finally {
      delete objectPrototype.environmentContext;
    }
  });

  it("leaves an inherited environment context out of the source document", () => {
    const definition = evalAgent({
      target: "agent:researcher",
      dataset: [{ id: "plain", input: "hi" }],
    });
    const discovered = {
      id: "eval:inherited",
      name: "Inherited",
      filePath: "evals/inherited.eval.ts",
      exportName: "default",
      definition,
    };
    // The framework builds its schemas before any project module loads.
    createEvalSourceDocument(discovered);
    const objectPrototype = Object.prototype as Record<string, unknown>;
    // A non-string inherited value must not fail the document either.
    for (const inherited of ["inherited context", 3]) {
      objectPrototype.environmentContext = inherited;
      try {
        const document = createEvalSourceDocument(discovered);

        // The runner sends only an own context, so Studio shows only that.
        assertEquals(Object.hasOwn(document, "environmentContext"), false);
        const [projected] = document.dataset.examples ?? [];
        assertEquals(projected === undefined, false);
        assertEquals(Object.hasOwn(projected ?? {}, "environmentContext"), false);
      } finally {
        delete objectPrototype.environmentContext;
      }
    }
  });

  it("leaves an inherited environment context out of the dataset hash", async () => {
    const hashOf = async (examples: Parameters<typeof datasets.inline>[0]) => {
      const dataset = datasets.inline(examples);
      return (await createEvalDatasetMetadata(dataset, await dataset.load({ baseDir: "." })))
        .hash;
    };
    const plain = await hashOf([{ id: "q1", input: "hi" }]);

    // An inherited context is not sent to the agent, so it is not hashed.
    const objectPrototype = Object.prototype as Record<string, unknown>;
    objectPrototype.environmentContext = "node: Inherited";
    try {
      assertEquals(await hashOf([{ id: "q1", input: "hi" }]), plain);
    } finally {
      delete objectPrototype.environmentContext;
    }
  });
});
