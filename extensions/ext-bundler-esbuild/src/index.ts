/**
 * ext-bundler-esbuild — Bundler + ModuleLexer contract implementations backed by
 * esbuild and es-module-lexer.
 *
 * @module extensions/ext-bundler-esbuild
 */

import type { ExtensionFactory } from "veryfront/extensions";

import { EsbuildBundler } from "./esbuild-bundler.ts";
import { EsModuleLexer } from "./es-module-lexer.ts";

/**
 * Default export — the ext-bundler-esbuild extension factory.
 *
 * Registers both the `Bundler` (esbuild-backed) and `ModuleLexer`
 * (es-module-lexer-backed) contracts.
 */
const extEsbuild: ExtensionFactory = () => {
  const bundler = new EsbuildBundler();
  const lexer = new EsModuleLexer();

  return {
    name: "ext-bundler-esbuild",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "Bundler" },
      { type: "contract", name: "ModuleLexer" },
    ],
    setup(ctx) {
      if (!ctx.get("Bundler")) {
        ctx.provide("Bundler", bundler);
      }
      if (!ctx.get("ModuleLexer")) {
        ctx.provide("ModuleLexer", lexer);
      }
      ctx.logger.info("[ext-bundler-esbuild] Bundler + ModuleLexer registered");
    },
    async teardown() {
      await bundler.stop?.();
    },
  };
};

export default extEsbuild;
export { EsbuildBundler, EsModuleLexer };
