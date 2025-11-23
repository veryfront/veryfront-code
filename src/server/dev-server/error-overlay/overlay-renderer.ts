/**
 * Error Overlay Renderer
 * Orchestrates error display rendering
 */

import { type ErrorInfo, getSuggestion } from "./error-formatter.ts";
import { generateErrorHTML, generateRuntimeScript } from "./html-template.ts";

/**
 * Main error overlay renderer class
 */
export class ErrorOverlay {
  /**
   * Gets the runtime script for browser error overlay
   */
  static getRuntime(): string {
    return generateRuntimeScript();
  }

  /**
   * Gets suggestion for an error
   */
  static getSuggestion(error: Error): string | undefined {
    return getSuggestion(error);
  }

  /**
   * Creates full HTML page for error display
   */
  static createHTML(errorInfo: ErrorInfo): string {
    const suggestion = errorInfo.suggestion || getSuggestion(errorInfo.error);
    return generateErrorHTML(errorInfo, suggestion);
  }
}
