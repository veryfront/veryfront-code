export { compileMDXToJS } from "./compiler/mdx-to-js.js";
export * from "./renderer/index.js";
export * from "./asset-pipeline/index.js";
export { buildEmbeddedPreset } from "./embedded/preset.js";

export interface EmbeddedPresetOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
}

export const EMBEDDED_PRESET_ID = "veryfront-embedded";
