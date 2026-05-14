/**
 * ext-css-tailwind — CSSProcessor implementation backed by Tailwind CSS v4.
 *
 * Provides the `CSSProcessor` contract:
 *  - `compile(stylesheet, options)` — delegates to tailwindcss `compile()`
 *    and returns a compiler whose `build(candidates)` emits CSS for the
 *    class-name candidates discovered at render time.
 *
 * The extension also installs three `globalThis` shims on setup so that
 * Tailwind plugin bundles loaded at runtime from esm.sh can bind their
 * `tailwindcss/plugin`, `tailwindcss/defaultTheme`, and `tailwindcss/colors`
 * imports to the same tailwindcss copy this extension ships. Core's
 * `plugin-loader.ts` rewrites plugin bundle code to reference these shims
 * by name; without the shims installed, dynamic plugin loading fails.
 *
 * @module extensions/ext-css-tailwind
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { CSSCompileOptions, CSSCompiler, CSSProcessor } from "veryfront/extensions/css";

import { compile } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import defaultTheme from "tailwindcss/defaultTheme";
import colors from "tailwindcss/colors";

type ShimGlobal = Record<string, unknown>;

function installTailwindPluginShims(): void {
  const g = globalThis as ShimGlobal;
  g.__tailwindPluginShim = { default: plugin, __esModule: true };
  g.__tailwindDefaultThemeShim = { default: defaultTheme, __esModule: true };
  g.__tailwindColorsShim = { default: colors, __esModule: true };
}

class TailwindCSSProcessor implements CSSProcessor {
  async compile(stylesheet: string, options: CSSCompileOptions): Promise<CSSCompiler> {
    const native = await compile(stylesheet, {
      base: options.base,
      loadStylesheet: options.loadStylesheet,
      loadModule: async (id: string) => {
        const loaded = await options.loadModule(id);
        // deno-lint-ignore no-explicit-any -- loaded plugin modules are opaque to the contract
        return { module: loaded.module as any, base: loaded.base, path: loaded.path };
      },
    });
    return {
      build(candidates: string[]): string {
        return native.build(candidates);
      },
    };
  }
}

const extTailwind: ExtensionFactory = () => {
  const impl = new TailwindCSSProcessor();
  return {
    name: "ext-css-tailwind",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "CSSProcessor" },
      { type: "net:outbound", hosts: ["esm.sh"] },
    ],
    setup(ctx) {
      installTailwindPluginShims();
      ctx.provide("CSSProcessor", impl);
      ctx.logger.info("[ext-css-tailwind] CSSProcessor registered");
    },
    teardown() {
      // Shims stay installed — removing them could break in-flight plugin
      // loads. The globalThis pollution is intentional and scoped to keys
      // with `__tailwind` prefix.
    },
  };
};

export default extTailwind;
export { TailwindCSSProcessor };
