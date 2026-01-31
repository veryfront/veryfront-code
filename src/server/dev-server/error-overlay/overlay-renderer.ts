import { type ErrorInfo, getSuggestion } from "./error-formatter.ts";
import { generateErrorHTML, generateRuntimeScript } from "./html-template.ts";

export const ErrorOverlay = {
  getRuntime: generateRuntimeScript,
  getSuggestion,
  createHTML(errorInfo: ErrorInfo): string {
    return generateErrorHTML(
      errorInfo,
      errorInfo.suggestion ?? getSuggestion(errorInfo.error),
    );
  },
};
