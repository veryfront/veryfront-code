import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  digestEntries,
  isFingerprintExcluded,
  selectUnitsToRun,
  UNITS,
} from "./run-generate.ts";

describe("isFingerprintExcluded", () => {
  it("excludes generated outputs wherever they live", () => {
    assertEquals(isFingerprintExcluded("templates/manifest.generated.ts"), true);
    assertEquals(
      isFingerprintExcluded("src/html/hydration-script-builder/hydration-runtime.generated.ts"),
      true,
    );
  });

  it("excludes the outputs that do not follow the generated naming", () => {
    assertEquals(isFingerprintExcluded("templates/manifest.json"), true);
    assertEquals(isFingerprintExcluded("src/build/production-build/templates.ts"), true);
  });

  it("excludes test files and keeps ordinary sources", () => {
    assertEquals(isFingerprintExcluded("src/utils/version.test.ts"), true);
    assertEquals(isFingerprintExcluded("src/utils/version.ts"), false);
    assertEquals(isFingerprintExcluded("templates/basic/deno.json"), false);
  });
});

describe("digestEntries", () => {
  const a = { path: "a.ts", digest: "aaa" };
  const b = { path: "b.ts", digest: "bbb" };

  it("is order-independent over entries", async () => {
    assertEquals(
      await digestEntries([a, b], "s"),
      await digestEntries([b, a], "s"),
    );
  });

  it("changes when a content digest or the salt changes", async () => {
    const base = await digestEntries([a, b], "s");
    assertNotEquals(base, await digestEntries([{ ...a, digest: "changed" }, b], "s"));
    assertNotEquals(base, await digestEntries([a, b], "other-deno"));
  });
});

describe("selectUnitsToRun", () => {
  it("selects stale and unstamped units, skips matching ones", () => {
    const selected = selectUnitsToRun(
      { fresh: "h1", stale: "h2", unstamped: "h3" },
      { fresh: "h1", stale: "old" },
      false,
    );

    assertEquals(selected.sort(), ["stale", "unstamped"]);
  });

  it("selects a stamped unit whose declared output is missing", () => {
    assertEquals(
      selectUnitsToRun({ a: "h" }, { a: "h" }, false, (name) => name === "a"),
      ["a"],
    );
    assertEquals(
      selectUnitsToRun({ a: "h" }, { a: "h" }, false, () => false),
      [],
    );
  });

  it("selects everything under force", () => {
    assertEquals(
      selectUnitsToRun({ a: "h" }, { a: "h" }, true),
      ["a"],
    );
  });
});

describe("UNITS", () => {
  it("covers the six generator steps of the stock chain", () => {
    assertEquals(UNITS.map((u) => u.name).sort(), [
      "bridge",
      "client-scripts",
      "dev-ui",
      "hydration-runtime",
      "rsc-scripts",
      "templates-manifest",
    ]);
  });

  it("declares its own generator script as an input for every scripts/build unit", () => {
    for (const unit of UNITS) {
      const script = unit.commands[0][unit.commands[0].length - 1];
      if (script.startsWith("scripts/build/")) {
        assertEquals(unit.inputFiles.includes(script), true, unit.name);
      }
    }
  });

  it("declares at least one output per unit, all excluded from fingerprints", () => {
    for (const unit of UNITS) {
      assertEquals(unit.outputs.length > 0, true, unit.name);
      for (const output of unit.outputs) {
        assertEquals(isFingerprintExcluded(output), true, output);
      }
    }
  });
});
