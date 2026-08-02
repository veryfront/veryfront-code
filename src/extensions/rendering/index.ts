/** Contracts for extension-owned rendering implementations. */

export {
  createIsolatedSsrRendererProvider,
  type IsolatedSsrRenderer,
  type IsolatedSsrRendererModule,
  type IsolatedSsrRendererProvider,
  IsolatedSsrRendererProviderName,
  MAX_ISOLATED_SSR_RENDERER_READ_ROOTS,
  MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS,
  snapshotIsolatedSsrRendererProvider,
  validateIsolatedSsrRendererModuleUrl,
} from "./isolated-ssr-renderer.ts";
