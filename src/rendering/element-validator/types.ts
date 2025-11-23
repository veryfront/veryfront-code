/**
 * Element Validator Types
 *
 * Shared type definitions and interfaces for React element validation.
 *
 * @module
 */

/**
 * Configuration options for element validation
 */
export interface ValidationOptions {
  /**
   * Maximum depth for recursive element tree inspection
   * @default 15
   */
  maxDepth?: number;

  /**
   * Enable debug mode for verbose logging
   * @default false
   */
  debugMode?: boolean;
}

/**
 * Details about an invalid object found during inspection
 */
export interface InvalidObjectDetails {
  /** Path to the invalid object in the element tree */
  path: string;

  /** Depth in the tree where the object was found */
  depth: number;

  /** Object keys (limited to first 15) */
  keys: string[];

  /** Whether the object has a $$typeof property */
  hasSymbol: boolean;

  /** Value of $$typeof if present */
  symbolValue: unknown;

  /** Type property if present */
  type: unknown;

  /** Constructor name if available */
  constructor: string | undefined;

  /** JSON sample of the object (first 500 chars) */
  sample: string;
}
