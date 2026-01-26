/****
 * Shared Error HTML Generator
 *
 * Generates styled error pages for 404, 500, and other HTTP errors.
 * Consolidated from multiple duplicate implementations to ensure consistency.
 */
export interface ErrorHtmlOptions {
    statusCode: number;
    title: string;
    message: string;
    /** Optional path to display in error message */
    pathname?: string;
    /** Use simple unstyled HTML (for minimal fallback) */
    minimal?: boolean;
}
/**
 * Generate a styled error page HTML.
 * Styled to match the Veryfront design system with dark mode support.
 */
export declare function generateErrorHtml(options: ErrorHtmlOptions): string;
/**
 * Common error configurations for quick use.
 */
export declare const ErrorPages: {
    notFound: (pathname?: string) => string;
    serverError: (message?: string) => string;
    undeployed: () => string;
    memoryPressure: () => string;
};
//# sourceMappingURL=error-html.d.ts.map