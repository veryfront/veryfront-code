import type { ComponentProps } from "@veryfront/types";
import { generateProdHydrationScript } from "./prod-hydration.ts";

export function getProdScripts(
  slug: string,
  _params?: Record<string, string | string[]>,
  props?: ComponentProps,
  nonce?: string,
): string {
  return generateProdHydrationScript(slug, _params, props, nonce);
}
