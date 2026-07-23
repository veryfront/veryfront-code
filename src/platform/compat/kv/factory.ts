import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SqliteStore } from "#veryfront/extensions/compat/native-services.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
} from "#veryfront/errors/error-registry/general.ts";
import { isDeno } from "../runtime.ts";
import { MemoryKv } from "./memory-adapter.ts";
import { NativeKv, type NativeKvBackend } from "./native-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { Kv, SqliteDatabase } from "./types.ts";

interface GlobalWithDenoKv {
  Deno?: {
    openKv?: (path?: string) => Promise<Kv>;
  };
}

export type KvBackend = "auto" | "native" | "sqlite" | "memory";

export interface OpenKvOptions {
  /** Select a storage implementation. Pin durable stores to avoid cross-runtime format changes. */
  backend?: KvBackend;
  /** Behavior when no native or SQLite backend is available. */
  fallback?: "error" | "memory";
}

export interface CreateKVStoreOptions extends OpenKvOptions {
  /** Use `:memory:` for an explicitly ephemeral store. */
  path?: string;
}

type ExplicitOpenKvOptions =
  & OpenKvOptions
  & (
    | { fallback: "error" | "memory" }
    | { backend: Exclude<KvBackend, "auto"> }
  );
type ExplicitCreateKVStoreOptions =
  & CreateKVStoreOptions
  & (
    | { path: string }
    | { fallback: "error" | "memory" }
    | { backend: Exclude<KvBackend, "auto"> }
  );

/** Backend dependencies used by the factory. Exported for deterministic integration tests. */
export interface KvFactoryBackends {
  nativeOpenKv?: (path?: string) => Promise<NativeKvBackend>;
  sqliteStore?: SqliteStore;
}

function normalizeOpenOptions(
  path: string | undefined,
  options: OpenKvOptions | undefined,
): { backend: KvBackend; fallback: "error" | "memory" } {
  if (options === undefined) {
    return { backend: "auto", fallback: path === undefined ? "memory" : "error" };
  }
  if (typeof options !== "object" || options === null) {
    throw INVALID_ARGUMENT.create({ message: "KV options must be an object" });
  }

  let optionsIsArray: boolean;
  let fallback: unknown;
  let backend: unknown;
  try {
    optionsIsArray = Array.isArray(options);
    fallback = Reflect.get(options, "fallback");
    backend = Reflect.get(options, "backend");
  } catch {
    throw INVALID_ARGUMENT.create({ message: "KV options must be readable" });
  }
  if (optionsIsArray) {
    throw INVALID_ARGUMENT.create({ message: "KV options must be an object" });
  }

  if (backend === undefined) backend = "auto";
  if (!["auto", "native", "sqlite", "memory"].includes(backend as string)) {
    throw INVALID_ARGUMENT.create({ message: "KV backend is invalid" });
  }
  if (fallback !== undefined && fallback !== "error" && fallback !== "memory") {
    throw INVALID_ARGUMENT.create({
      message: "KV fallback must be either 'error' or 'memory'",
    });
  }
  if (backend !== "auto" && backend !== "memory" && fallback === "memory") {
    throw INVALID_ARGUMENT.create({
      message: "A pinned durable KV backend cannot fall back to memory",
    });
  }
  if (backend === "memory" && path !== undefined && path !== ":memory:") {
    throw INVALID_ARGUMENT.create({ message: "The memory KV backend cannot use a durable path" });
  }
  if (path === ":memory:" && backend !== "auto" && backend !== "memory") {
    throw INVALID_ARGUMENT.create({ message: "The :memory: KV path requires the memory backend" });
  }

  return {
    backend: backend as KvBackend,
    fallback: fallback as "error" | "memory" | undefined ??
      (backend === "auto" && path === undefined ? "memory" : "error"),
  };
}

function initializationError(detail: string) {
  return INITIALIZATION_ERROR.create({
    message: "KV storage could not be initialized",
    detail,
  });
}

async function closeRejectedResource(resource: unknown): Promise<void> {
  if ((typeof resource !== "object" && typeof resource !== "function") || resource === null) return;
  try {
    const close = Reflect.get(resource, "close");
    if (typeof close === "function") await Reflect.apply(close, resource, []);
  } catch {
    // The initialization error remains primary and provider details stay private.
  }
}

/**
 * Open a KV store using explicit backend dependencies.
 *
 * A configured backend failure is terminal. The factory never reinterprets a
 * failed persistent store through another format or hides it with memory.
 */
export async function openKvWithBackends(
  path: string | undefined,
  options: OpenKvOptions | undefined,
  backends: KvFactoryBackends,
): Promise<Kv> {
  if (path !== undefined && typeof path !== "string") {
    throw INVALID_ARGUMENT.create({ message: "KV path must be a string" });
  }
  const { backend, fallback } = normalizeOpenOptions(path, options);

  if (path === ":memory:" || backend === "memory") return new MemoryKv();

  if (backend === "auto" || backend === "native") {
    let nativeOpenKv: KvFactoryBackends["nativeOpenKv"];
    try {
      nativeOpenKv = Reflect.get(backends, "nativeOpenKv") as KvFactoryBackends["nativeOpenKv"];
    } catch {
      throw initializationError("The native KV backend could not be inspected.");
    }

    if (nativeOpenKv !== undefined) {
      if (typeof nativeOpenKv !== "function") {
        throw initializationError("The native KV backend is invalid.");
      }
      let nativeBackend: NativeKvBackend;
      try {
        nativeBackend = await nativeOpenKv(path);
      } catch {
        throw initializationError("The native KV backend could not be opened.");
      }
      try {
        return new NativeKv(nativeBackend);
      } catch {
        await closeRejectedResource(nativeBackend);
        throw initializationError("The native KV backend returned an invalid store.");
      }
    }
    if (backend === "native") {
      throw initializationError("The native KV backend is not available.");
    }
  }

  if (backend === "auto" || backend === "sqlite") {
    let sqliteStore: SqliteStore | undefined;
    try {
      sqliteStore = Reflect.get(backends, "sqliteStore") as SqliteStore | undefined;
    } catch {
      throw initializationError("The SQLite KV backend could not be inspected.");
    }

    if (sqliteStore !== undefined) {
      let openSqliteDatabase: SqliteStore["openSqliteDatabase"];
      try {
        openSqliteDatabase = Reflect.get(sqliteStore, "openSqliteDatabase") as
          | SqliteStore["openSqliteDatabase"]
          | undefined;
      } catch {
        throw initializationError("The SQLite KV backend could not be inspected.");
      }

      if (openSqliteDatabase !== undefined) {
        if (typeof openSqliteDatabase !== "function") {
          throw initializationError("The SQLite KV backend is invalid.");
        }
        let database: unknown;
        try {
          database = await Reflect.apply(openSqliteDatabase, sqliteStore, [path]);
        } catch {
          throw initializationError("The SQLite KV backend could not be opened.");
        }
        try {
          return new SqliteKv(database as SqliteDatabase);
        } catch {
          await closeRejectedResource(database);
          throw initializationError("The SQLite KV backend returned an invalid store.");
        }
      }
    }
    if (backend === "sqlite") {
      throw initializationError("The SQLite KV backend is not available.");
    }
  }

  if (fallback === "memory") return new MemoryKv();

  throw initializationError(
    "No persistent KV backend is available. Use native KV support or register a SQLite storage extension.",
  );
}

function resolveNativeOpenKv(): KvFactoryBackends["nativeOpenKv"] {
  if (!isDeno) return undefined;

  const global = globalThis as GlobalWithDenoKv;
  let deno: GlobalWithDenoKv["Deno"];
  let open: ((path?: string) => Promise<NativeKvBackend>) | undefined;
  try {
    deno = Reflect.get(global, "Deno") as GlobalWithDenoKv["Deno"];
    open = deno && Reflect.get(deno, "openKv") as
      | ((path?: string) => Promise<NativeKvBackend>)
      | undefined;
  } catch {
    throw initializationError("The native KV backend could not be inspected.");
  }
  if (open === undefined) return undefined;
  if ((open as unknown) === openPolyfilledKv) return undefined;
  if (typeof open !== "function") {
    throw initializationError("The native KV backend is invalid.");
  }
  return (path?: string) => Reflect.apply(open, deno, [path]);
}

function openPolyfilledKv(path?: string): Promise<Kv> {
  return openKvWithBackends(path, undefined, {
    sqliteStore: tryResolve<SqliteStore>("SqliteStore"),
  });
}

function openAvailableKv(path?: string, options?: OpenKvOptions): Promise<Kv> {
  return openKvWithBackends(path, options, {
    nativeOpenKv: resolveNativeOpenKv(),
    sqliteStore: tryResolve<SqliteStore>("SqliteStore"),
  });
}

export function openKv(path: string, options?: OpenKvOptions): Promise<Kv>;
export function openKv(path: undefined, options: ExplicitOpenKvOptions): Promise<Kv>;
/** @deprecated Pathless calls must pass an explicit fallback policy. */
export function openKv(): Promise<Kv>;
/** @deprecated Pathless calls must pass an explicit fallback policy. */
export function openKv(path: undefined, options?: OpenKvOptions): Promise<Kv>;
export function openKv(path?: string, options?: OpenKvOptions): Promise<Kv> {
  return openAvailableKv(path, options);
}

export function createKVStore(options: ExplicitCreateKVStoreOptions): Promise<Kv>;
/** @deprecated Pass `{ path: ":memory:" }`, a durable path, or an explicit fallback policy. */
export function createKVStore(): Promise<Kv>;
/** @deprecated Options without a path or fallback policy can silently select memory. */
export function createKVStore(options: CreateKVStoreOptions | undefined): Promise<Kv>;
export function createKVStore(options?: CreateKVStoreOptions): Promise<Kv> {
  if (options === undefined) return openKv();
  if (typeof options !== "object" || options === null) {
    return Promise.reject(INVALID_ARGUMENT.create({ message: "KV options must be an object" }));
  }

  let optionsIsArray: boolean;
  let path: unknown;
  let fallback: unknown;
  let backend: unknown;
  try {
    optionsIsArray = Array.isArray(options);
    path = Reflect.get(options, "path");
    fallback = Reflect.get(options, "fallback");
    backend = Reflect.get(options, "backend");
  } catch {
    return Promise.reject(INVALID_ARGUMENT.create({ message: "KV options must be readable" }));
  }
  if (optionsIsArray) {
    return Promise.reject(INVALID_ARGUMENT.create({ message: "KV options must be an object" }));
  }

  return openAvailableKv(path as string | undefined, { backend, fallback } as OpenKvOptions);
}

/**
 * Install Veryfront's string-key, JSON-value KV subset as `Deno.openKv`.
 *
 * @deprecated Use `createKVStore`. This compatibility helper does not provide
 * the complete native `Deno.Kv` contract.
 */
export function polyfillDenoKv(): void {
  const global = globalThis as GlobalWithDenoKv;
  try {
    let deno = Reflect.get(global, "Deno") as GlobalWithDenoKv["Deno"];
    if (deno === undefined) {
      deno = {};
      if (!Reflect.set(global, "Deno", deno)) throw new TypeError("Deno global is not writable");
    }
    if ((typeof deno !== "object" && typeof deno !== "function") || deno === null) {
      throw new TypeError("Deno global is invalid");
    }

    const existing = Reflect.get(deno, "openKv");
    if (existing === undefined) {
      if (!Reflect.set(deno, "openKv", openPolyfilledKv)) {
        throw new TypeError("Deno.openKv is not writable");
      }
      return;
    }
    if (typeof existing !== "function") throw new TypeError("Deno.openKv is invalid");
  } catch {
    throw initializationError("The Deno KV compatibility API could not be installed.");
  }
}
