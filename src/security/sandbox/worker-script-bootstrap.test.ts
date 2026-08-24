import "#veryfront/schemas/_test-setup.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("worker-script bootstrap source", () => {
  it("preloads host environment access before project modules", async () => {
    const source = await readTextFile(
      fromFileUrl(new URL("./worker-script.ts", import.meta.url)),
    );
    const envImport = 'import "#veryfront/platform/compat/process/env.ts";';
    const envIndex = source.indexOf(envImport);
    assertEquals(
      envIndex >= 0,
      true,
      "worker-script.ts must side-effect import the host env primordials",
    );

    const otherImportIndexes = [...source.matchAll(/^import (?!type )[^\n]*$/gm)]
      .map((match) => match.index!)
      .filter((index) => index !== envIndex);
    assertEquals(
      otherImportIndexes.length > 0,
      true,
      "worker-script.ts must still carry the value imports this ordering guards",
    );
    assertEquals(
      otherImportIndexes.every((index) => envIndex < index),
      true,
      "the host-environment primordial capture must be the first evaluated import in worker-script.ts, before any module that project code can influence",
    );
  });
});
