/**
 * Element Validator
 *
 * Validates React element trees to detect invalid children that would cause React Error #31.
 * Provides deep inspection and normalization for React elements.
 *
 * ## Architecture
 *
 * This module is organized into focused, single-responsibility components:
 *
 * - **types.ts** - Shared type definitions and interfaces
 * - **primitive-checks.ts** - Utility functions for validating primitives and React elements
 * - **element-inspector.ts** - Deep inspection logic for traversing element trees
 * - **element-normalizer.ts** - Element validation and normalization before rendering
 * - **validator-core.ts** - Main ElementValidator class that orchestrates validation
 *
 * ## Features
 *
 * - Deep recursive inspection of React element trees
 * - Detection of invalid objects that would cause React Error #31
 * - Automatic normalization of React elements
 * - Configurable depth limits and debug mode
 * - Detailed error reporting with path information
 *
 * ## Usage
 *
 * ### Basic Validation
 *
 * ```ts
 * import { ElementValidator } from "#veryfront/render/rendering/element-validator'
 *
 * const validator = new ElementValidator()
 * const validElement = validator.ensureValidReactElement(pageElement)
 * ```
 *
 * ### With Deep Inspection
 *
 * ```ts
 * const validator = new ElementValidator({ maxDepth: 20, debugMode: true })
 * const validElement = validator.ensureValidReactElement(pageElement, true)
 * ```
 *
 * ### Manual Inspection
 *
 * ```ts
 * const validator = new ElementValidator()
 * validator.deepInspectElement(element, 'root', 0)
 * ```
 *
 * ## Error Detection
 *
 * The validator detects and reports invalid objects that would cause React Error #31:
 * - Plain objects passed as children
 * - Invalid data structures in props
 * - Non-React objects in element trees
 *
 * @module
 */

// Core class
export { ElementValidator } from "./validator-core.ts";

// Types
export type { InvalidObjectDetails, ValidationOptions } from "./types.ts";

// Inspection utilities (advanced usage)
export { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";

// Normalization utilities (advanced usage)
export { ensureValidReactElement, type NormalizationOptions } from "./element-normalizer.ts";

// Primitive checks (advanced usage)
export {
  getElementTypeName,
  getObjectKeys,
  getObjectSample,
  hasReactSymbol,
  isValidPrimitive,
  looksLikeReactElement,
} from "./primitive-checks.ts";
