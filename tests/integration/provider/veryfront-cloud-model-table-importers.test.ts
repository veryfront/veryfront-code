import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const SHIPPED_TABLE_MODULE = "model-catalog.data.ts";
const SHIM_MODULE = "src/provider/veryfront-cloud/model-catalog.deprecated.ts";

/** Every non-test source file under `src/`, relative to the repository root. */
async function sourceFiles(root: URL, dir = "src"): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(new URL(`${dir}/`, root))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) files.push(...await sourceFiles(root, path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test(-helpers)?\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("veryfront-cloud shipped model table", () => {
  it("is the only source module that imports the shipped table", async () => {
    const root = new URL("../../../", import.meta.url);
    const importers: string[] = [];
    for (const path of await sourceFiles(root)) {
      if (path.endsWith(`/${SHIPPED_TABLE_MODULE}`)) continue;
      const text = await Deno.readTextFile(new URL(path, root));
      if (
        new RegExp(`^import(?! type)[^;]*["'][^"']*${SHIPPED_TABLE_MODULE}["']`, "m").test(text)
      ) {
        importers.push(path);
      }
    }

    assertEquals(importers, [SHIM_MODULE]);
  });
});
