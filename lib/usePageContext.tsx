/**
 * Re-export from veryfront/context to ensure SSR and client use the same React context.
 * This prevents hydration mismatches caused by different context instances.
 *
 * CRITICAL: Must use bare specifier "veryfront/context" NOT relative path "../src/exports/context.ts"
 * - SSR resolves via deno.json import map to local src/exports/context.ts
 * - Browser resolves via HTML import map to /_vf_modules/exports/context.js
 * - Using relative path creates different module URLs = different React contexts = broken hooks
 */
export {
  PageContextProvider,
  usePageContext,
  type PageContextValue as PageContext,
} from "veryfront/context";

// Default export for compatibility
export { usePageContext as default } from "veryfront/context";
