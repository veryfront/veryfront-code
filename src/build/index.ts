/**
 * Build module exports
 */

export { compileMDXToJS } from "./compiler/mdx-to-js.ts";
export * from "./renderer/index.ts";

export interface EmbeddedPresetOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
}

export const EMBEDDED_PRESET_ID = "veryfront-embedded";

export { buildEmbeddedPreset } from "./embedded/preset.ts";

export * from "./asset-pipeline/index.ts";
