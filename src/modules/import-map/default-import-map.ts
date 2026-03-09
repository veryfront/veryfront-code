import type { ImportMapConfig } from "./types.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";

/**
 * SSR import map for veryfront/* modules.
 *
 * IMPORTANT: When adding a new export to deno.json that contains React
 * hooks or components, add it here too. Without an entry, the module
 * won't go through the SSR transform pipeline, causing dual-React
 * errors or "Module not found" 500s in production.
 */
function getVeryfrontSsrImportMap(): Record<string, string> {
  const base = "/_vf_modules/_veryfront";
  const ssr = "?ssr=true";

  const head = `${base}/react/components/Head.js${ssr}`;
  const router = `${base}/react/router/index.js${ssr}`;
  const context = `${base}/react/context/index.js${ssr}`;
  const fonts = `${base}/react/fonts/index.js${ssr}`;

  const markdown = `${base}/markdown/index.js${ssr}`;
  const chat = `${base}/chat/index.js${ssr}`;
  const mdx = `${base}/mdx/index.js${ssr}`;

  // Map veryfront/workflow to the React hooks submodule for SSR.
  // The full workflow/index.ts imports heavy server-side code (executor, backends, DAG)
  // that fails to transform and produces unresolved relative imports. SSR only needs
  // the React hooks (useWorkflowStart, useWorkflowList, useWorkflow, useApproval).
  const workflowReact = `${base}/workflow/react/index.js${ssr}`;

  // veryfront/react is a barrel that re-exports all browser-side modules.
  const react = `${base}/react/public.js${ssr}`;

  // Map veryfront/embedding to the React hooks submodule for SSR.
  // The full embedding/index.ts imports heavy server-side code (vectorStore, ragStore,
  // AI SDK) that fails to transform. SSR only needs the React hook (useUploads).
  const embedding = `${base}/embedding/react/index.js${ssr}`;

  return {
    "veryfront/react": react,
    "veryfront/head": head,
    "veryfront/router": router,
    "veryfront/context": context,
    "veryfront/fonts": fonts,
    "veryfront/markdown": markdown,
    "veryfront/chat": chat,
    "veryfront/mdx": mdx,
    "veryfront/embedding": embedding,
    "veryfront/workflow": workflowReact,
    "veryfront/react/head": head,
    "veryfront/react/router": router,
    "veryfront/react/context": context,
    "veryfront/react/fonts": fonts,
  };
}

export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: { ...getVeryfrontSsrImportMap(), ...getReactImportMap() },
  };
}
