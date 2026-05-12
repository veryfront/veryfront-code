/**
 * es-module-lexer-backed implementation of the {@link ModuleLexer} contract.
 *
 * es-module-lexer@2 exports `init` as a Promise in its ESM build but older
 * typings expect a function. We tolerate both shapes (as the in-tree
 * src/transforms/esm/lexer.ts did).
 *
 * @module extensions/ext-bundler-esbuild/es-module-lexer
 */

import type { ImportSpecifier, ModuleLexer } from "veryfront/extensions/bundler";
import { init, parse } from "es-module-lexer";

/** es-module-lexer-backed {@link ModuleLexer} implementation. */
export class EsModuleLexer implements ModuleLexer {
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    const anyInit = init as unknown;
    this.initPromise = typeof anyInit === "function"
      ? (anyInit as () => Promise<void>)()
      : (anyInit as Promise<void>);
    await this.initPromise;
  }

  parse(code: string): readonly ImportSpecifier[] {
    const [imports] = parse(code);
    return imports as readonly ImportSpecifier[];
  }
}
