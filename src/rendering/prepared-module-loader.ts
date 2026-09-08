import { IMPORT_RESOLUTION_ERROR, INVALID_ARGUMENT, MODULE_NOT_FOUND } from "#veryfront/errors";
import type {
  RuntimeModuleLoader,
  RuntimeModuleReference,
} from "#veryfront/platform/adapters/base.ts";
import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { isAbsolute, resolve } from "#veryfront/compat/path";
import {
  assertBoundedPathString,
  assertCanonicalProjectRelativePath,
  toCanonicalProjectRelativePath,
} from "#veryfront/utils/project-relative-path.ts";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";
import type { WorkerGenerationIdentity } from "#veryfront/security/sandbox/worker-generation.ts";
import {
  type RenderGenerationBinding,
  resolveRenderGenerationIdentity,
} from "#veryfront/rendering/render-generation-binding.ts";

type PreparedImport = () => Promise<Record<string, unknown>>;
type DataRecord = Record<PropertyKey, unknown>;

export interface PreparedRenderModuleLoaderOptions {
  readonly binding: RenderGenerationBinding;
  /** Replica-local root of the matching immutable source filesystem view. */
  readonly projectDir: string;
  /** Compiler-generated imports indexed by canonical project-relative source paths. */
  readonly sources: Readonly<Record<string, PreparedImport>>;
  /** Compiler-generated imports indexed by exact package specifiers. */
  readonly packages: Readonly<Record<string, PreparedImport>>;
  /** Combined source/package entry budget. The caller must bound source and artifact bytes. */
  readonly maxEntries: number;
}

/** One executor-owned import capability, never rebound to a different generation. */
export interface PreparedRenderModuleLoader extends RuntimeModuleLoader {
  readonly identity: Readonly<WorkerGenerationIdentity>;
}

const apply = Reflect.apply;
const freeze = Object.freeze;
const create = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;
const hasOwn = Object.hasOwn;
const isSafeInteger = Number.isSafeInteger;

function invalidInput() {
  return INVALID_ARGUMENT.create({ detail: "Prepared render imports require valid bounded data" });
}

function requireRecord(value: unknown): DataRecord {
  if (
    !canIdentifyProxyWithoutHooks || value === null || typeof value !== "object" ||
    isProxyWithoutHooks(value)
  ) throw invalidInput();
  return value as DataRecord;
}

function dataProperty(value: DataRecord, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor || !hasOwn(descriptor, "value")) throw invalidInput();
  return descriptor.value;
}

function specifier(value: unknown): string {
  try {
    const text = assertBoundedPathString(value);
    if (!isWellFormedString(text)) throw invalidInput();
    return text;
  } catch {
    throw invalidInput();
  }
}

/**
 * Capture a prepared source/package import table before serving one generation.
 * All inputs are captured before hashing yields; creation never imports a module.
 * Unknown references fail without filesystem, cache, package, or network fallback.
 * Native imports own module caching; this capability adds no request queue or cache.
 *
 * The trusted bootstrap must verify the compiler-generated table against the
 * binding's artifact identity and retain its matching immutable filesystem view.
 * This function captures callbacks, not source bytes, and does not establish
 * authority, verify artifact contents, or sandbox their execution. Install it once
 * in a dedicated execution realm; stop that executor before releasing artifacts.
 */
export async function createPreparedRenderModuleLoader(
  options: PreparedRenderModuleLoaderOptions,
): Promise<PreparedRenderModuleLoader> {
  const input = requireRecord(options);
  const binding = dataProperty(input, "binding") as RenderGenerationBinding;
  const root = specifier(dataProperty(input, "projectDir"));
  if (!isAbsolute(root)) throw invalidInput();
  const projectDir = resolve(root);
  const maxEntries = dataProperty(input, "maxEntries");
  if (typeof maxEntries !== "number" || !isSafeInteger(maxEntries) || maxEntries < 1) {
    throw invalidInput();
  }
  const entryLimit = maxEntries;
  let entryCount = 0;
  function capture(value: unknown, source: boolean): Readonly<Record<string, PreparedImport>> {
    const table = requireRecord(value);
    const keys = ownKeys(table);
    entryCount += keys.length;
    if (entryCount > entryLimit) throw invalidInput();
    const captured = create(null) as Record<string, PreparedImport>;
    for (let index = 0; index < keys.length; index++) {
      const key = specifier(keys[index]);
      if (source) {
        try {
          assertCanonicalProjectRelativePath(key);
        } catch {
          throw invalidInput();
        }
      }
      const load = dataProperty(table, key);
      if (typeof load !== "function" || isProxyWithoutHooks(load)) throw invalidInput();
      const descriptor = create(null) as PropertyDescriptor;
      descriptor.value = load;
      descriptor.enumerable = true;
      defineProperty(captured, key, descriptor);
    }
    return freeze(captured);
  }
  const sources = capture(dataProperty(input, "sources"), true);
  const packages = capture(dataProperty(input, "packages"), false);
  const identity = await resolveRenderGenerationIdentity(binding);
  return freeze({
    identity,
    async importModule(reference: RuntimeModuleReference): Promise<Record<string, unknown>> {
      const value = requireRecord(reference);
      const kind = dataProperty(value, "kind");
      let key: string;
      let table: Readonly<Record<string, PreparedImport>>;
      if (kind === "source") {
        try {
          key = toCanonicalProjectRelativePath(projectDir, specifier(dataProperty(value, "path")));
        } catch {
          throw invalidInput();
        }
        table = sources;
      } else if (kind === "package") {
        key = specifier(dataProperty(value, "specifier"));
        table = packages;
      } else throw invalidInput();
      const load = table[key];
      if (!load) {
        throw MODULE_NOT_FOUND.create({ detail: "Module was not prepared for this generation" });
      }
      const module: unknown = await apply(load, undefined, []);
      if (module === null || typeof module !== "object") {
        throw IMPORT_RESOLUTION_ERROR.create({
          detail: "Prepared import did not return a module namespace",
        });
      }
      return module as Record<string, unknown>;
    },
  });
}
