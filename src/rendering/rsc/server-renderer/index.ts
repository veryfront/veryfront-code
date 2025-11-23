/**
 * RSC Server Renderer - Entry point
 *
 * Modular implementation of React Server Components renderer.
 * Split from monolithic server-renderer.ts for better maintainability.
 *
 * @module server-renderer
 */

// Export main renderer class
export { RSCRenderer } from "./rsc-renderer.ts";

// Export utility functions for advanced use cases
export {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
} from "./component-detector.ts";

export { serializeProps } from "./prop-serializer.ts";

export { escapeHtml, renderAttributes, treeToHTML } from "./html-generator.ts";

export { processElement, renderChildren, renderTree } from "./tree-processor.ts";
