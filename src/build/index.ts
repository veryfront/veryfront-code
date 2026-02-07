export { compileMDXToJS } from "./compiler/mdx-to-js.ts";
export { compileAllMDX, watchMDX } from "./compiler/mdx-compiler/index.ts";
export { buildProduction } from "./production-build/build/build-orchestrator.ts";
export { buildEmbeddedPreset } from "./embedded/preset.ts";

export interface EmbeddedPresetOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
}

export const EMBEDDED_PRESET_ID = "veryfront-embedded";
