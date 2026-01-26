/**
 * Embedded templates for production builds
 * These are embedded as strings to avoid file system dependencies in npm bundle
 * @module
 */
/**
 * Client-side CSS styles for loading states, error display, and prose formatting
 */
export declare const CLIENT_STYLES = "body {\n  margin: 0;\n  font-family:\n    -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;\n  line-height: 1.5;\n}\n\n.loading-container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  min-height: 100vh;\n  background: #f9fafb;\n}\n\n.loading-spinner {\n  width: 40px;\n  height: 40px;\n  border: 3px solid #e5e7eb;\n  border-top-color: #3b82f6;\n  border-radius: 50%;\n  animation: spin 1s linear infinite;\n}\n\n@keyframes spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n.error-container {\n  max-width: 600px;\n  margin: 2rem auto;\n  padding: 2rem;\n  background: #fee;\n  border: 1px solid #fcc;\n  border-radius: 8px;\n  color: #c00;\n}\n\n.prose {\n  max-width: 65ch;\n  margin: 0 auto;\n  padding: 2rem;\n}\n\n.prose h1, .prose h2, .prose h3 {\n  margin-top: 2em;\n  margin-bottom: 1em;\n}\n\n.prose p {\n  margin-bottom: 1.5em;\n}\n\n.prose code {\n  background: #f3f4f6;\n  padding: 0.2em 0.4em;\n  border-radius: 3px;\n  font-size: 0.875em;\n}\n\n.prose pre {\n  background: #1f2937;\n  color: #f9fafb;\n  padding: 1em;\n  border-radius: 8px;\n  overflow-x: auto;\n}\n\n.prose pre code {\n  background: transparent;\n  padding: 0;\n  color: inherit;\n}";
/**
 * Pre-bundled client router script for npm builds
 * Placeholder - this is auto-generated during build:npm
 */
export declare let CLIENT_ROUTER_BUNDLE: string | undefined;
export declare let CLIENT_PREFETCH_BUNDLE: string | undefined;
//# sourceMappingURL=templates.d.ts.map