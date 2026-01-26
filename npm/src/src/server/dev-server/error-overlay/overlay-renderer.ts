import { type ErrorInfo, getSuggestion } from "./error-formatter.js";
import { generateErrorHTML, generateRuntimeScript } from "./html-template.js";

export const ErrorOverlay = {
  getRuntime: generateRuntimeScript,
  getSuggestion,
  createHTML(errorInfo: ErrorInfo): string {
    const suggestion = errorInfo.suggestion ?? getSuggestion(errorInfo.error);
    return generateErrorHTML(errorInfo, suggestion);
  },
};
