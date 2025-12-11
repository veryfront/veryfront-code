
import { type ErrorInfo, getSuggestion } from "./error-formatter.ts";
import { generateErrorHTML, generateRuntimeScript } from "./html-template.ts";

export class ErrorOverlay {
  static getRuntime(): string {
    return generateRuntimeScript();
  }

  static getSuggestion(error: Error): string | undefined {
    return getSuggestion(error);
  }

  static createHTML(errorInfo: ErrorInfo): string {
    const suggestion = errorInfo.suggestion || getSuggestion(errorInfo.error);
    return generateErrorHTML(errorInfo, suggestion);
  }
}
