export { compileMDXToJS } from "./compiler/mdx-to-js.ts";
export { compileAllMDX, watchMDX } from "./compiler/mdx-compiler/index.ts";
export * from "./renderer/index.ts";
export * from "./asset-pipeline/index.ts";
export * from "./production-build/index.ts";
export { buildEmbeddedPreset } from "./embedded/preset.ts";

export interface EmbeddedPresetOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
}

export const EMBEDDED_PRESET_ID = "veryfront-embedded";
