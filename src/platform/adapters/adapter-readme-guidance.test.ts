import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const ADAPTER_README_FILES = [
  "src/data/README.md",
  "src/routing/api/README.md",
  "src/server/README.md",
  "src/platform/README.md",
  "src/platform/adapters/README.md",
] as const;

const DEPRECATED_GET_ADAPTER_EXAMPLE =
  /\b(?:import\s+\{[^}]*\bgetAdapter\b[^}]*\}|\bgetAdapter\s*\()/;
const STALE_ADAPTER_ALIAS = /["']#adapters["']|#adapters\b/;
const STALE_RUNTIME_ADAPTER_EXAMPLE =
  /\badapter\.runtime\b|\badapter\.fs\.readTextFile\b|\badapter\.fs\.writeTextFile\b|\bnew MockAdapter\b|\bcreateFileCacheAdapter\b|\bserver\.listen\s*\(/;

describe("platform adapter README guidance", () => {
  it("uses current runtime adapter examples and import paths", async () => {
    const offenders: string[] = [];

    for (const file of ADAPTER_README_FILES) {
      const contents = await Deno.readTextFile(file);
      if (
        DEPRECATED_GET_ADAPTER_EXAMPLE.test(contents) ||
        STALE_ADAPTER_ALIAS.test(contents) ||
        STALE_RUNTIME_ADAPTER_EXAMPLE.test(contents)
      ) {
        offenders.push(file);
      }
    }

    assertEquals(offenders, []);
  });
});
