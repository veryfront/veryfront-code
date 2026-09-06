import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { parseMaskedImports } from "../../esm/lexer.ts";
import { getLocalFs } from "./cache/index.ts";
import {
  markJsxArtifactServed,
  refreshJsxArtifactMtime,
  resolveOwnedJsxArtifactPath,
  retainJsxArtifactsReferencedIn,
  withJsxArtifactLock,
  withJsxArtifactWriteCapacity,
} from "./jsx-cache.ts";
import { assertMdxModuleSourceSize, MAX_MDX_MODULE_CODE_BYTES } from "./module-fetcher/limits.ts";

type LazyLoader = <T>(
  load: (options?: ImportCallOptions) => Promise<T>,
  options?: ImportCallOptions,
) => Promise<T>;
interface Registration {
  loaders: LazyLoader[];
  references: number;
}

// Only evaluating parents occupy this bridge. Generated modules capture the
// callbacks at evaluation, then own their lifetime without a global payload cache.
const bridgeKey = Symbol.for("veryfront.mdx.lazy-jsx-imports.v1");
const globals = globalThis as typeof globalThis & {
  [bridgeKey]?: Map<string, Registration>;
};
const registrations = globals[bridgeKey] ??= new Map<string, Registration>();
// A tiny shared module has its own lexical scope, so authored bindings named
// Symbol or globalThis cannot shadow bridge initialization. It contains no
// project payload and works in disk-loaded and compiled runtimes alike.
const bridgeModule = "data:text/javascript," + encodeURIComponent(
  `export default key => globalThis[Symbol.for(${
    JSON.stringify(Symbol.keyFor(bridgeKey))
  })].get(key).loaders;`,
);

function createLoader(path: string, source: string, cacheDir: string): LazyLoader {
  return async (load, options) => {
    const fs = getLocalFs();
    await withJsxArtifactWriteCapacity(cacheDir, path, async (assertCapacityOwned) => {
      await withJsxArtifactLock(path, async (assertArtifactOwned) => {
        if (!await fs.exists(path)) {
          await assertCapacityOwned();
          await assertArtifactOwned();
          await fs.writeTextFile(path, source);
        }
        await refreshJsxArtifactMtime(path, 0, Date.now(), true);
        markJsxArtifactServed(path);
      });
    });
    const release = await retainJsxArtifactsReferencedIn(
      `import ${JSON.stringify(`file://${path}`)};`,
      cacheDir,
      false,
    );
    try {
      return await load(options);
    } finally {
      release();
    }
  };
}

/** A temporary bridge from the host loader to one evaluated MDX module. */
export class LazyJsxImportScope {
  #keys: string[] = [];

  async rewrite(code: string, cacheDir: string): Promise<string> {
    const parsed = await parseMaskedImports(code);
    const paths = new Map<string, number>();
    const loaders: LazyLoader[] = [];
    const sources: string[] = [];
    let payloadBytes = 0;
    // Content-derived bindings keep module identity stable and avoid collisions
    // with authored identifiers, including escaped identifier spellings.
    const binding = `__vf_lazy_${await computeHash(code)}`;
    for (const imported of parsed.imports) {
      if (imported.d < 0) continue;
      const path = resolveOwnedJsxArtifactPath(imported.n, cacheDir);
      if (path === undefined) continue;
      let index = paths.get(path);
      if (index === undefined) {
        const reader = captureBoundedTextReader(getLocalFs());
        const snapshot = await withJsxArtifactLock(
          path,
          () => reader.readUtf8(path, MAX_MDX_MODULE_CODE_BYTES, "Lazy JSX artifact"),
        );
        payloadBytes += snapshot.byteLength;
        assertMdxModuleSourceSize("Lazy JSX recovery payload", payloadBytes);
        index = loaders.length;
        paths.set(path, index);
        sources.push(path, snapshot.content);
        loaders.push(createLoader(path, snapshot.content, cacheDir));
      }
    }
    if (loaders.length === 0) return code;
    const key = await computeHash(JSON.stringify(sources));
    const registration = registrations.get(key) ?? { loaders, references: 0 };
    registration.references++;
    registrations.set(key, registration);
    this.#keys.push(key);
    const rewriteRange = (start: number, end: number): string => {
      let result = "";
      let cursor = start;
      for (const imported of parsed.imports) {
        if (imported.ss < cursor || imported.se > end || imported.d < 0) continue;
        const path = resolveOwnedJsxArtifactPath(imported.n, cacheDir);
        const index = path === undefined ? undefined : paths.get(path);
        if (index === undefined) continue;
        result += parsed.masked.slice(cursor, imported.ss);
        if (imported.a >= 0) {
          // Options remain at the call site: await/yield, this, and arguments
          // belong to the authored scope, not to the recovery callback.
          const optionBinding = `${binding}_options`;
          const invocation = parsed.masked.slice(imported.ss, imported.a) + optionBinding + ")";
          const options = rewriteRange(imported.a, imported.se - 1);
          result += `${binding}[${index}]((${optionBinding}) => ${invocation}, ${options})`;
        } else {
          result += `${binding}[${index}](() => ${parsed.masked.slice(imported.ss, imported.se)})`;
        }
        cursor = imported.se;
      }
      return result + parsed.masked.slice(cursor, end);
    };
    const rewritten = rewriteRange(0, parsed.masked.length);
    const declaration = `import ${binding}_bridge from ${JSON.stringify(bridgeModule)};\n` +
      `const ${binding} = ${binding}_bridge(${JSON.stringify(key)});\n`;
    return declaration + parsed.unmask(rewritten);
  }

  release(): void {
    for (const key of this.#keys) {
      const registration = registrations.get(key);
      if (registration && --registration.references === 0) registrations.delete(key);
    }
    this.#keys = [];
  }
}
