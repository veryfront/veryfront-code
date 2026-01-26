/**
 * Error Overlay Module
 * Handles error display in development mode
 */
export { ErrorOverlay } from "./overlay-renderer.js";
export { formatErrorType, getSuggestion, } from "./error-formatter.js";
export { generateErrorHTML, generateRuntimeScript } from "./html-template.js";
export { formatStackTrace, hasStackTrace, parseStackTrace, } from "./stack-parser.js";
