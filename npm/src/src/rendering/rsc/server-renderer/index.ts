export { RSCRenderer } from "./rsc-renderer.js";

export {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
} from "./component-detector.js";

export { serializeProps, stringifyProps } from "./prop-serializer.js";
export { escapeHtml, renderAttributes, treeToHTML } from "./html-generator.js";
export { processElement, renderChildren, renderTree } from "./tree-processor.js";
