/**
 * Import rewriting strategies index.
 *
 * All strategies are exported here for use by UnifiedImportRewriter.
 */

export { AliasStrategy, aliasStrategy } from "./alias-strategy.js";
export { BareStrategy, bareStrategy } from "./bare-strategy.js";
export { NodeBuiltinStrategy, nodeBuiltinStrategy } from "./node-builtin-strategy.js";
export {
  CrossProjectStrategy,
  crossProjectStrategy,
  isCrossProjectImport,
  parseCrossProjectImport,
} from "./cross-project-strategy.js";
export {
  ImportMapStrategy,
  importMapStrategy,
  resolveImportWithMap,
} from "./import-map-strategy.js";
export { ReactStrategy, reactStrategy } from "./react-strategy.js";
export { RelativeStrategy, relativeStrategy } from "./relative-strategy.js";
export { UrlStrategy, urlStrategy } from "./url-strategy.js";
export { VendorStrategy, vendorStrategy } from "./vendor-strategy.js";
export { VeryfrontStrategy, veryfrontStrategy } from "./veryfront-strategy.js";
