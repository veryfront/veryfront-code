import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as build from "./index.ts";
import type {
  BuildEmbeddedOptions,
  BuildOptions,
  BuildStats,
  CompileOptions,
  CompileResult,
  CompileToJSOptions,
  CompileToJSResult,
  EmbeddedBuildResult,
  MDXFrontmatter,
} from "./index.ts";

describe("build public API", () => {
  it("exports the supported runtime entry points", () => {
    assertEquals(Object.keys(build).sort(), [
      "LOCAL_RELEASE_ASSET_MANIFEST_PATH",
      "buildEmbeddedPreset",
      "buildProduction",
      "compileAllMDX",
      "compileMDXToJS",
      "watchMDX",
    ]);
  });

  it("exports the contracts used by its public functions", () => {
    const contracts: [
      BuildOptions,
      BuildStats,
      CompileOptions,
      CompileResult,
      CompileToJSOptions,
      CompileToJSResult,
      MDXFrontmatter,
      BuildEmbeddedOptions,
      EmbeddedBuildResult,
    ] | null = null;
    assertEquals(contracts, null);
  });
});
