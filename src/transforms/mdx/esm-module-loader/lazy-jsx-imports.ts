import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { CACHE_ERROR } from "#veryfront/errors";
import { primordialArrayPush } from "#veryfront/platform/compat/primordials/array.ts";
import { parseMaskedImports } from "#veryfront/transforms/esm/lexer.ts";
import { getLocalFs } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  ensureJsxCacheSweepArmed,
  markJsxArtifactServed,
  refreshJsxArtifactMtime,
  resolveOwnedJsxArtifactPath,
  retainJsxArtifactsReferencedIn,
  withJsxArtifactLock,
  withJsxArtifactWriteCapacity,
} from "#veryfront/transforms/mdx/esm-module-loader/jsx-cache.ts";
import {
  assertMdxModuleSourceSize,
  MAX_MDX_MODULE_CODE_BYTES,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/limits.ts";

type LazyLoader = <T>(
  load: (options?: ImportCallOptions) => Promise<T>,
  options?: ImportCallOptions,
) => Promise<T>;
interface Registration {
  loaders: readonly LazyLoader[];
  references: number;
}

const IntrinsicMap = Map;
const IntrinsicReflectApply = Reflect.apply;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeKeys = Map.prototype.keys;
const MapIteratorNext: MapIterator<string>["next"] = Object.getPrototypeOf(new Map().keys()).next;
const MapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return IntrinsicReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  IntrinsicReflectApply(MapPrototypeSet, map, [key, value]);
}

// Only evaluating parents occupy this bridge. Their callbacks retain lookup
// keys, while source text stays in the bounded shared recovery cache.
const registrations = new IntrinsicMap<string, Registration>();
const getRegistration = registrations.get.bind(registrations);
const setRegistration = registrations.set.bind(registrations);
const deleteRegistration = registrations.delete.bind(registrations);
const freeze = Object.freeze;
const stringify = JSON.stringify;
const keySalt = crypto.randomUUID();
const MAX_RECOVERY_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_RECOVERY_SNAPSHOTS = 256;
const recoverySnapshots = new IntrinsicMap<string, { source: string; bytes: number }>();
let recoverySnapshotBytes = 0;

function readRecoverySnapshot(key: string): string | undefined {
  const snapshot = mapGet(recoverySnapshots, key);
  if (!snapshot) return undefined;
  IntrinsicReflectApply(MapPrototypeDelete, recoverySnapshots, [key]);
  mapSet(recoverySnapshots, key, snapshot);
  return snapshot.source;
}

async function rememberRecoverySnapshot(source: string): Promise<string> {
  const key = await computeHash(keySalt + source);
  if (readRecoverySnapshot(key) !== undefined) return key;
  // Charge UTF-16 source storage plus the fixed hash and entry bookkeeping.
  const bytes = source.length * 2 + 256;
  while (
    recoverySnapshotBytes + bytes > MAX_RECOVERY_SNAPSHOT_BYTES ||
    IntrinsicReflectApply(MapSizeGetter, recoverySnapshots, []) >= MAX_RECOVERY_SNAPSHOTS
  ) {
    const iterator = IntrinsicReflectApply(MapPrototypeKeys, recoverySnapshots, []);
    const oldest = IntrinsicReflectApply(MapIteratorNext, iterator, []).value as string;
    const snapshot = mapGet(recoverySnapshots, oldest)!;
    recoverySnapshotBytes -= snapshot.bytes;
    IntrinsicReflectApply(MapPrototypeDelete, recoverySnapshots, [oldest]);
  }
  mapSet(recoverySnapshots, key, { source, bytes });
  recoverySnapshotBytes += bytes;
  return key;
}
const bridgeName = `__vf_lazy_jsx_bridge_${crypto.randomUUID()}`;
Object.defineProperty(globalThis, bridgeName, {
  configurable: false,
  writable: false,
  value: freeze((key: string): readonly LazyLoader[] => {
    const registration = getRegistration(key);
    if (!registration) throw new Error("Lazy JSX recovery registration is unavailable");
    return registration.loaders;
  }),
});
// A tiny shared module has its own lexical scope, so authored bindings named
// Symbol or globalThis cannot shadow bridge initialization. It contains no
// project payload and works in disk-loaded and compiled runtimes alike.
const bridgeModule = "data:text/javascript;base64," + btoa(
  `export default globalThis[${stringify(bridgeName)}];`,
);

/** Read-only observation for lifecycle tests; no registration data is exposed. */
export const __lazyJsxImportInternals = {
  registrationCount: (): number =>
    IntrinsicReflectApply(MapSizeGetter, registrations, []) as number,
  snapshotCount: (): number =>
    IntrinsicReflectApply(MapSizeGetter, recoverySnapshots, []) as number,
  snapshotBytes: (): number => recoverySnapshotBytes,
  clearSnapshotsForTests: () => {
    while (recoverySnapshotBytes > 0) {
      const iterator = IntrinsicReflectApply(MapPrototypeKeys, recoverySnapshots, []);
      const key = IntrinsicReflectApply(MapIteratorNext, iterator, []).value as string;
      recoverySnapshotBytes -= mapGet(recoverySnapshots, key)!.bytes;
      IntrinsicReflectApply(MapPrototypeDelete, recoverySnapshots, [key]);
    }
  },
};

function createLoader(path: string, snapshotKey: string, cacheDir: string): LazyLoader {
  return async (load, options) => {
    const stableOptions = snapshotImportOptions(options);
    const fs = getLocalFs();
    ensureJsxCacheSweepArmed(cacheDir);
    const hit = await withJsxArtifactLock(path, async () => {
      if (!await fs.exists(path)) return false;
      await refreshJsxArtifactMtime(path, 0, Date.now(), true);
      markJsxArtifactServed(path);
      return true;
    });
    if (!hit) {
      // Release the hit-check lease before acquiring quota. Writers and quota
      // pruning consistently take the directory lease before artifact leases.
      await withJsxArtifactWriteCapacity(cacheDir, path, async (assertCapacityOwned) => {
        await withJsxArtifactLock(path, async (assertArtifactOwned) => {
          if (!await fs.exists(path)) {
            const source = readRecoverySnapshot(snapshotKey);
            if (source === undefined) {
              throw CACHE_ERROR.create({
                detail: "Lazy JSX recovery snapshot was evicted. Reload the MDX module.",
              });
            }
            await assertCapacityOwned();
            await assertArtifactOwned();
            await fs.writeTextFile(path, source);
          }
          await refreshJsxArtifactMtime(path, 0, Date.now(), true);
          markJsxArtifactServed(path);
        });
      });
    }
    const release = await retainJsxArtifactsReferencedIn(
      `import ${stringify(`file://${path}`)};`,
      cacheDir,
      false,
    );
    try {
      return await load(stableOptions);
    } finally {
      release();
    }
  };
}

/** Native import reads attributes before its returned promise can be observed. */
function snapshotImportOptions(
  options: ImportCallOptions | undefined,
): ImportCallOptions | undefined {
  if (options === undefined) return undefined;
  if (options === null || (typeof options !== "object" && typeof options !== "function")) {
    throw new TypeError("Import options must be an object");
  }
  const attributes = options.with;
  if (attributes === undefined) return undefined;
  if (attributes === null || (typeof attributes !== "object" && typeof attributes !== "function")) {
    throw new TypeError("Import attributes must be an object");
  }
  const snapshot: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string") throw new TypeError("Import attribute values must be strings");
    snapshot[key] = value;
  }
  return { with: snapshot };
}

/** A temporary bridge from the host loader to one evaluated MDX module. */
export class LazyJsxImportScope {
  #keys: string[] = [];

  get hasRegistrations(): boolean {
    return this.#keys.length > 0;
  }

  async rewrite(code: string, cacheDir: string): Promise<string> {
    const parsed = await parseMaskedImports(code);
    const paths = new IntrinsicMap<string, number>();
    const loaders: LazyLoader[] = [];
    let sourceIdentity = keySalt;
    let payloadBytes = 0;
    // Content-derived bindings keep module identity stable and avoid collisions
    // with authored identifiers, including escaped identifier spellings.
    const binding = `__vf_lazy_${await computeHash(code)}`;
    for (const imported of parsed.imports) {
      if (imported.d < 0) continue;
      const path = resolveOwnedJsxArtifactPath(imported.n, cacheDir);
      if (path === undefined) continue;
      let index = mapGet(paths, path);
      if (index === undefined) {
        const reader = captureBoundedTextReader(getLocalFs());
        const snapshot = await withJsxArtifactLock(
          path,
          () => reader.readUtf8(path, MAX_MDX_MODULE_CODE_BYTES, "Lazy JSX artifact"),
        );
        payloadBytes += snapshot.byteLength;
        assertMdxModuleSourceSize("Lazy JSX recovery payload", payloadBytes);
        index = loaders.length;
        mapSet(paths, path, index);
        const snapshotKey = await rememberRecoverySnapshot(snapshot.content);
        sourceIdentity += `${path.length}:${path}${snapshotKey}`;
        primordialArrayPush(loaders, freeze(createLoader(path, snapshotKey, cacheDir)));
      }
    }
    if (loaders.length === 0) return code;
    // Keys are stable within this host instance but cannot be derived from a
    // different project's source. The lookup bridge exposes no enumeration.
    const key = await computeHash(sourceIdentity);
    const registration = getRegistration(key) ?? {
      loaders: freeze(loaders),
      references: 0,
    };
    registration.references++;
    setRegistration(key, registration);
    primordialArrayPush(this.#keys, key);
    const rewriteRange = (start: number, end: number): string => {
      let result = "";
      let cursor = start;
      for (const imported of parsed.imports) {
        if (imported.ss < cursor || imported.se > end || imported.d < 0) continue;
        const path = resolveOwnedJsxArtifactPath(imported.n, cacheDir);
        const index = path === undefined ? undefined : mapGet(paths, path);
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
    const declaration = `import ${binding}_bridge from ${stringify(bridgeModule)};\n` +
      `const ${binding} = ${binding}_bridge(${stringify(key)});\n`;
    return declaration + parsed.unmask(rewritten);
  }

  release(): void {
    for (let index = 0; index < this.#keys.length; index++) {
      const key = this.#keys[index]!;
      const registration = getRegistration(key);
      if (registration && --registration.references === 0) deleteRegistration(key);
    }
    this.#keys = [];
  }
}
