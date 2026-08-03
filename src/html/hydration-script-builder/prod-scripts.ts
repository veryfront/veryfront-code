import { HYDRATION_RUNTIME_BUNDLE } from "./hydration-runtime.generated.ts";
import { buildNonceAttribute } from "../html-escape.ts";
import { fnv1aHash } from "#veryfront/utils/hash-utils.ts";
export {
  isVersionedProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
  PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN,
} from "./prod-path.ts";

let cachedProdHydrationModulePath: string | null = null;

/**
 * The hydration runtime the browser loads, bundled from the typed modules in
 * `runtime/` by `scripts/build/prebundle-hydration-runtime.ts`. React and the
 * veryfront react runtime stay bare imports so the document's import map
 * resolves them.
 */
export function generateProdHydrationModule(): string {
  return HYDRATION_RUNTIME_BUNDLE;
}

export function getProdHydrationModulePath(): string {
  if (cachedProdHydrationModulePath) return cachedProdHydrationModulePath;

  const hash = fnv1aHash(generateProdHydrationModule()).padStart(8, "0");
  cachedProdHydrationModulePath = `/_veryfront/hydration-runtime.${hash}.js`;
  return cachedProdHydrationModulePath;
}

export function getProdScripts(
  _slug: string,
  _params?: Record<string, string | string[]>,
  _props?: Record<string, unknown>,
  nonce?: string,
): string {
  const nonceAttr = buildNonceAttribute(nonce);
  return `\n  <script type="module" src="${getProdHydrationModulePath()}"${nonceAttr}></script>`;
}
