
export { ElementValidator } from "./validator-core.ts";

export type { InvalidObjectDetails, ValidationOptions } from "./types.ts";

export { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";

export { ensureValidReactElement, type NormalizationOptions } from "./element-normalizer.ts";

export {
  getElementTypeName,
  getObjectKeys,
  getObjectSample,
  hasReactSymbol,
  isValidPrimitive,
  looksLikeReactElement,
} from "./primitive-checks.ts";
