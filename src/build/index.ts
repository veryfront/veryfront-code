/**
 * Build module exports
 */

// Narrow re-exports to avoid name collisions under strict typecheck
// export { compileMDXFile } from './compiler/mdx-compiler.ts' // Removed: deleted module
export { compileMDXToJS } from "./compiler/mdx-to-js.ts";
export * from "./renderer/index.ts";

// Embedded preset (scaffold): placeholder types and constants for upcoming Tauri embedding
export interface EmbeddedPresetOptions {
  projectDir: string;
  outDir: string;
  runtime: "deno" | "node" | "bun";
}

export const EMBEDDED_PRESET_ID = "veryfront-embedded";

export { buildEmbeddedPreset } from "./embedded/preset.ts";

// Asset Pipeline - Automated image and CSS optimization
export * from "./asset-pipeline/index.ts";
