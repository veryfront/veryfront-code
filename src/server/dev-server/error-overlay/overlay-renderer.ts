/**
 * Error Overlay Renderer
 * Orchestrates error display rendering
 */

import { type ErrorInfo, getSuggestion } from "./error-formatter.ts";
import { generateErrorHTML, generateRuntimeScript } from "./html-template.ts";

/**
 * Error overlay utilities for development error display
 */
export const ErrorOverlay = {
  getRuntime: generateRuntimeScript,
  getSuggestion,
  createHTML(errorInfo: ErrorInfo): string {
    const suggestion = errorInfo.suggestion || getSuggestion(errorInfo.error);
    return generateErrorHTML(errorInfo, suggestion);
  },
};
