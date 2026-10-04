import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { toFileUrl } from "#std/path";
import { fromFileUrl as fromWindowsFileUrl } from "jsr:@std/path@1.1.4/windows/from-file-url";
import {
  extractRunsFixtures,
  generateRunsFixtures,
} from "../../../scripts/generate-runs-fixtures.ts";

const contractDir = new URL("../../../src/runs/contract/", import.meta.url);

describe("Runs fixture formatter paths", () => {
  it("regenerates valid fixtures and hashes in a directory with spaces", async () => {
    await withTempDir(async (path) => {
      const directory = toFileUrl(`${path}/contract examples/`);
      await Deno.mkdir(directory);
      for (const file of ["openapi.target.json", "runs-api.generated.ts", "pin.json"]) {
        await Deno.copyFile(new URL(file, contractDir), new URL(file, directory));
      }
      await generateRunsFixtures(directory);
      const pin = JSON.parse(await Deno.readTextFile(new URL("pin.json", directory)));
      for (const file of Object.keys(pin.files)) {
        const bytes = await Deno.readFile(new URL(file, directory));
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
        assertEquals(pin.files[file], expected, file);
      }
      const generated = await import(new URL("runs-fixtures.generated.ts", directory).href);
      const document = JSON.parse(
        await Deno.readTextFile(new URL("openapi.target.json", directory)),
      );
      assertEquals(generated.RUNS_OPERATION_FIXTURES, extractRunsFixtures(document));
      assertEquals(pin.fixturesGeneratedBy, "deno task contracts:runs:fixtures");
    });
  });

  it("decodes Windows drive and UNC file URLs without platform mutations", () => {
    assertEquals(
      fromWindowsFileUrl(new URL("file:///C:/contract%20examples/runs-fixtures.generated.ts")),
      "C:\\contract examples\\runs-fixtures.generated.ts",
    );
    const unc = fromWindowsFileUrl(
      new URL("file://server/share/contract%20examples/runs-fixtures.generated.ts"),
    );
    assertEquals(unc, "\\\\server\\share\\contract examples\\runs-fixtures.generated.ts");
  });
});
