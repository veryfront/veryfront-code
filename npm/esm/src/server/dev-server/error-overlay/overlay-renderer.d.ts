import { type ErrorInfo, getSuggestion } from "./error-formatter.js";
import { generateRuntimeScript } from "./html-template.js";
export declare const ErrorOverlay: {
    getRuntime: typeof generateRuntimeScript;
    getSuggestion: typeof getSuggestion;
    createHTML(errorInfo: ErrorInfo): string;
};
//# sourceMappingURL=overlay-renderer.d.ts.map