/**
 * Blog template for Veryfront
 *
 * This file re-exports the blog template and TemplateFile interface for backwards compatibility.
 * The actual template components are now organized in the blog/ subdirectory.
 */

export type { TemplateFile } from "./types.ts";
export { blogTemplate } from "./blog/index.ts";
