/**
 * Content category barrel — content transformer (MDX/Markdown) contract.
 *
 * @module extensions/transform
 */

// Type aliases (unions / shape aliases)
export type { CompilationMode, CompilationTarget, ContentPlugin } from "./content-transformer.ts";

// Interfaces
export type {
  ContentCompileOptions,
  ContentRuntimeBundle,
  ContentTransformer,
} from "./content-transformer.ts";
