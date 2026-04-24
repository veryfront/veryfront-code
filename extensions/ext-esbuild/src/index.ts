/**
 * ext-esbuild — Bundler + ModuleLexer contract implementations backed by
 * esbuild and es-module-lexer.
 *
 * This file is a scaffold. Task 4 ports the real esbuild implementation of
 * the Bundler contract; Task 5 ports the es-module-lexer implementation of
 * the ModuleLexer contract. For now both are stub classes whose methods
 * throw, but the factory registers cleanly so the workspace member and
 * contract wiring can be verified end-to-end.
 *
 * @module extensions/ext-esbuild
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  BundleOptions,
  Bundler,
  BundleResult,
  ImportSpecifier,
  ModuleLexer,
  TransformOptions,
  TransformResult,
} from "veryfront/extensions/interfaces";

class EsbuildBundler implements Bundler {
  // deno-lint-ignore require-await
  async bundle(_options: BundleOptions): Promise<BundleResult> {
    throw new Error("EsbuildBundler.bundle: not yet implemented (Task 4)");
  }
  // deno-lint-ignore require-await
  async transform(_options: TransformOptions): Promise<TransformResult> {
    throw new Error("EsbuildBundler.transform: not yet implemented (Task 4)");
  }
  // deno-lint-ignore require-await
  async stop(): Promise<void> {
    // Task 4 will replace with esbuild.stop().
  }
}

class EsModuleLexer implements ModuleLexer {
  // deno-lint-ignore require-await
  async init(): Promise<void> {
    throw new Error("EsModuleLexer.init: not yet implemented (Task 5)");
  }
  parse(_code: string): readonly ImportSpecifier[] {
    throw new Error("EsModuleLexer.parse: not yet implemented (Task 5)");
  }
}

/**
 * Default export — the ext-esbuild extension factory.
 *
 * Registers both the `Bundler` and `ModuleLexer` contracts. The
 * implementations are stubs in this task; see Tasks 4 and 5 for the real
 * ports.
 */
const extEsbuild: ExtensionFactory = () => {
  const bundler = new EsbuildBundler();
  const lexer = new EsModuleLexer();

  return {
    name: "ext-esbuild",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "Bundler" },
      { type: "contract", name: "ModuleLexer" },
    ],
    setup(ctx) {
      ctx.provide("Bundler", bundler);
      ctx.provide("ModuleLexer", lexer);
      ctx.logger.info("[ext-esbuild] Bundler + ModuleLexer registered (stubs)");
    },
    async teardown() {
      await bundler.stop?.();
    },
  };
};

export default extEsbuild;
export { EsbuildBundler, EsModuleLexer };
