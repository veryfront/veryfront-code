import { escapeHtml } from "../../html/html-escape.js";
export { escapeHtml };
/**
 * Create text node safely (alternative to innerHTML for simple text).
 */
export declare function createSafeTextNode(text: string): Text;
/**
 * Set text content safely (never interprets HTML).
 */
export declare function setSafeTextContent(element: HTMLElement, text: string): void;
export interface ValidateTrustedHtmlOptions {
    /** Throw on suspicious patterns even in dev mode */
    strict?: boolean;
    /** Log warnings for suspicious patterns */
    warn?: boolean;
}
/**
 * Validate trusted HTML from server (defense-in-depth).
 *
 * This is NOT a full sanitizer - server-rendered RSC content is trusted.
 * This catches scenarios where the server might be compromised or misconfigured.
 *
 * @param html - HTML string from server
 * @param options - Validation options
 * @returns The original HTML if valid
 * @throws Error if suspicious patterns detected in strict mode or production
 */
export declare function validateTrustedHtml(html: string, options?: ValidateTrustedHtmlOptions): string;
/**
 * Create an error display element safely using DOM APIs.
 * Use this instead of innerHTML for displaying error messages.
 */
export declare function createErrorDisplay(options: {
    title: string;
    message: string;
    details?: string;
    style?: Partial<CSSStyleDeclaration>;
}): HTMLDivElement;
//# sourceMappingURL=html-sanitizer.d.ts.map