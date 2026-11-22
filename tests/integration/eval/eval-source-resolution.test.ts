import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { findEvalById, resolveEvalById } from "#veryfront/eval/discovery.ts";
import type { DiscoveredEval } from "#veryfront/eval/discovery.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

/** A valid eval source in the shape the Veryfront API writes for an eval made in Studio. */
const EVAL_SOURCE = `import { datasets, evalAgent, metrics } from 'veryfront/eval'

export default evalAgent({
  name: "<EVAL_NAME>",
  target: "agent:assistant",
  dataset: datasets.inline([
    {
      "id": "q1",
      "input": "Capital of France?",
      "reference": "Paris"
    }
  ]),
  metrics: [
    metrics.answer.contains({
    "text": "Paris"
  }).gate(),
  ],
  repetitions: 1,
  tags: [],
  metadata: {},
})
`;

/**
 * Write `files` into a fresh project and resolve `evalId` through the real
 * filesystem adapter and module loader. Any network request fails the test:
 * resolving project source must not reach the network.
 */
async function resolveInProject(
  files: Record<string, string>,
  evalId: string,
  run: (
    resolve: () => Promise<DiscoveredEval>,
    find: () => Promise<DiscoveredEval | null>,
    projectDir: string,
  ) => Promise<void>,
): Promise<void> {
  await withTempDir(async (projectDir) => {
    for (const [path, content] of Object.entries(files)) {
      const target = `${projectDir}/${path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
      await Deno.writeTextFile(target, content);
    }
    const options = {
      projectDir,
      adapter: await getAdapter(),
      allowHostProjectCodeExecution: true,
    };
    await withMockFetch(
      (input) => {
        throw new Error(`Unexpected network request: ${String(input)}`);
      },
      () =>
        run(
          () => resolveEvalById(evalId, options),
          () => findEvalById(evalId, options),
          projectDir,
        ),
    );
  }, { prefix: "vf-eval-source-" });
}

async function rejection(promise: Promise<unknown>): Promise<VeryfrontError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof VeryfrontError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("eval source resolution from a project directory", () => {
  // Every test transpiles its fixture with esbuild. Clear compiled modules so no
  // test reuses another's, and stop the esbuild service the suite started.
  afterEach(() => {
    clearTranspileCache();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  it("resolves evals/<name>.eval.ts to eval:<name>", async () => {
    await resolveInProject(
      { "evals/by-hand.eval.ts": EVAL_SOURCE },
      "eval:by-hand",
      async (resolve, find) => {
        const found = await resolve();
        assertEquals(found.id, "eval:by-hand");
        assertEquals(found.definition.target, "agent:assistant");
        assertEquals((await find())?.id, "eval:by-hand", "findEvalById agrees");
      },
    );
  });

  it("resolves the source Studio writes when the description is left empty", async () => {
    await resolveInProject(
      {
        "evals/by-hand.eval.ts": EVAL_SOURCE.replace("  target:", '  description: "",\n  target:'),
      },
      "eval:by-hand",
      async (resolve) => {
        const found = await resolve();
        assertEquals(found.id, "eval:by-hand");
        assertEquals(Object.hasOwn(found.definition, "description"), false);
      },
    );
  });

  it("resolves a nested eval file without the .eval suffix", async () => {
    await resolveInProject(
      { "evals/rag/retrieval.ts": EVAL_SOURCE },
      "eval:rag/retrieval",
      async (resolve) => {
        assertEquals((await resolve()).id, "eval:rag/retrieval");
      },
    );
  });

  it("names the file and the load error, with no local path, when the file does not load", async () => {
    const broken = EVAL_SOURCE.replace(
      'metrics.answer.contains({\n    "text": "Paris"\n  })',
      'metrics.answer.contains("Paris" as never)',
    );
    await resolveInProject(
      { "evals/by-hand.eval.ts": broken },
      "eval:by-hand",
      async (resolve, find, projectDir) => {
        await assertRejects(
          resolve,
          VeryfrontError,
          "Eval eval:by-hand failed to load from evals/by-hand.eval.ts: answer.contains text must be a non-empty string. Fix the file, then run the eval again.",
        );
        const error = await rejection(resolve());
        assertEquals(error.slug, "eval-load-failed");
        assertEquals(error.message.includes(projectDir), false, "no local path in the message");
        assertEquals(await find(), null, "findEvalById still reports a miss");
      },
    );
  });

  it("reports a missing eval with the path it looked for and the fix", async () => {
    await resolveInProject(
      { "evals/other.eval.ts": EVAL_SOURCE },
      "eval:missing",
      async (resolve, _find, projectDir) => {
        await assertRejects(
          resolve,
          VeryfrontError,
          "Eval not found: eval:missing. Veryfront looks for it in evals/missing.eval.ts (or a .tsx, .js or .jsx file at that path), exported with evalAgent, evalTool or evalDataset. Ensure the file is in the source this run uses, or use the ID that the evals list shows.",
        );
        const error = await rejection(resolve());
        assertEquals(error.slug, "eval-not-found");
        assertEquals(error.message.includes(projectDir), false, "no local path in the message");
      },
    );
  });
});
