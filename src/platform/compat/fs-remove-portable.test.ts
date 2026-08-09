/**
 * Removal behaviour that must agree on every runtime.
 *
 * Deliberately free of any reference to the Deno namespace, and that is
 * load-bearing rather than stylistic: both `tests/node/run-tests.mjs` and
 * `tests/bun/run-tests.mjs` drop a file whose own source names it -- including,
 * on a first draft of this comment, a file that only named it to explain the
 * rule. So the sibling suite in
 * `fs.test.ts` runs on Deno alone. Deno selects `DenoFileSystem`, which already
 * behaved; `NodeFileSystem` is the implementation that did not, and it refuses
 * to initialise under Deno at all. Coverage of the fix therefore has to come
 * from a file the other runners will actually pick up.
 *
 * Everything below goes through the module's own exports, so each runtime
 * exercises whichever implementation it selects.
 *
 * @module platform/compat/fs-remove-portable
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, mkdir, remove, writeTextFile } from "./fs.ts";
import { join } from "./path/index.ts";

let testDir: string;

beforeAll(async () => {
  testDir = await makeTempDir({ prefix: "vf-fs-remove-portable-" });
});

afterAll(async () => {
  await remove(testDir, { recursive: true });
});

describe("remove, across runtimes", () => {
  it("removes an empty directory without the recursive option", async () => {
    const dirPath = join(testDir, "empty-dir");
    await mkdir(dirPath);

    await remove(dirPath);

    assertEquals(await exists(dirPath), false);
  });

  it("refuses a non-empty directory without the recursive option", async () => {
    const dirPath = join(testDir, "populated-dir");
    await mkdir(dirPath);
    await writeTextFile(join(dirPath, "file.txt"), "test");

    await assertRejects(() => remove(dirPath), Error);

    assertEquals(await exists(dirPath), true, "the directory must survive the refusal");
  });
});
