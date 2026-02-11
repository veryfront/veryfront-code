/**
 * Rsc - Server Renderer
 *
 * @module rendering/rsc/server-renderer
 */

export { RSCRenderer } from "./rsc-renderer.ts";

export {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
} from "./component-detector.ts";

export { serializeProps, stringifyProps } from "./prop-serializer.ts";
export { escapeHtml, renderAttributes, treeToHTML } from "./html-generator.ts";
export { processElement, renderChildren, renderTree } from "./tree-processor.ts";
