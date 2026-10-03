import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  finalizeNpmWorkerEntrypoints,
  NPM_WORKER_ENTRYPOINT,
} from "../../../scripts/build/npm-worker-entrypoints.ts";

Deno.test("npm worker finalization rejects missing compiled worker", async () => {
  const root = await makeTempDir();
  try {
    await assertRejects(
      () => finalizeNpmWorkerEntrypoints(root, { exports: {} }),
      Error,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("npm worker stays compiled without a public export", async () => {
  const root = await makeTempDir();
  try {
    await Deno.mkdir(`${root}/esm/src/config`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/esm/src/config/declarative-evaluator-worker-entry.js`,
      "export {};",
    );
    const pkg = {
      dependencies: { "@veryfront/ext-parser-babel": "unpublished-rc", zod: "4.3.6" },
      exports: {
        ".": { import: "./esm/src/index.js" },
        [NPM_WORKER_ENTRYPOINT.name]: {
          import: "./esm/src/config/declarative-evaluator-worker-entry.js",
        },
      },
    };
    await finalizeNpmWorkerEntrypoints(root, pkg);
    assertEquals(Object.keys(pkg.exports), ["."]);
    assertEquals(pkg.dependencies, { zod: "4.3.6" });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
