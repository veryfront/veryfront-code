/**
 * Error Overlay Module
 * Handles error display in development mode
 */

export { ErrorOverlay } from "./overlay-renderer.ts";
export {
  type ErrorInfo,
  type ErrorType,
  formatErrorType,
  getSuggestion,
} from "./error-formatter.ts";
export { generateErrorHTML, generateRuntimeScript } from "./html-template.ts";
export {
  formatStackTrace,
  hasStackTrace,
  type ParsedStackFrame,
  parseStackTrace,
} from "./stack-parser.ts";
