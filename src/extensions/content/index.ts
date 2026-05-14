/**
 * Content category barrel for the MDX/Markdown content processor contract.
 *
 * @module extensions/content
 */

// Type aliases (unions / shape aliases)
export type { CompilationMode, CompilationTarget, ContentPlugin } from "./content-processor.ts";

// Interfaces
export type {
  ContentCompileOptions,
  ContentProcessingResult,
  ContentProcessor,
} from "./content-processor.ts";
