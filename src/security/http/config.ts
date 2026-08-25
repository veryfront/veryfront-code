import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SecurityConfig } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getConfig, validateVeryfrontConfig } from "#veryfront/config";
import { serverLogger } from "#veryfront/utils";
import { buildCSP, generateNonce } from "./response/security-handler.ts";
import { isProduction } from "#veryfront/platform/environment.ts";

const logger = serverLogger.component("security-config-loader");

export interface DerivedSecurityContext {
  securityConfig: SecurityConfig;
}

export interface DeriveSecurityContextOptions {
  /**
   * Apply security defaults used by production runtimes. Defaults to the
   * process environment; callers with an independently trusted runtime
   * classification may override it explicitly.
   */
  productionDefaults?: boolean;
  /**
   * Origins derived from the project's released source. Platform-supplied;
   * anything a project config carries under this name is discarded.
   */
  derivedCsp?: SecurityConfig["derivedCsp"];
}

const MAX_SECURITY_CONFIG_DEPTH = 32;
const MAX_SECURITY_CONFIG_ENTRIES = 10_000;
const MAX_SECURITY_CONFIG_ARRAY_LENGTH = 1_024;

interface SecuritySnapshotState {
  readonly clones: WeakMap<object, unknown>;
  readonly active: WeakSet<object>;
  entries: number;
}

function invalidSecurityConfig(): never {
  throw new TypeError("Invalid security configuration");
}

function consumeSecurityEntry(state: SecuritySnapshotState): void {
  state.entries++;
  if (state.entries > MAX_SECURITY_CONFIG_ENTRIES) invalidSecurityConfig();
}

function cloneAndFreezeSecurityValue<T>(
  value: T,
  state: SecuritySnapshotState = {
    clones: new WeakMap(),
    active: new WeakSet(),
    entries: 0,
  },
  depth = 0,
): T {
  if (value === null) return value;

  if (depth > MAX_SECURITY_CONFIG_DEPTH) return invalidSecurityConfig();

  if (typeof value === "function") {
    const source = value as (...args: unknown[]) => unknown;
    const cached = state.clones.get(source);
    if (cached !== undefined) return cached as T;

    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      return Reflect.apply(source, this, args);
    };
    state.clones.set(source, wrapped);
    return Object.freeze(wrapped) as T;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : invalidSecurityConfig();
  }
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value !== "object") return invalidSecurityConfig();

  const source = value as object;
  if (state.active.has(source)) return invalidSecurityConfig();
  const cached = state.clones.get(source);
  if (cached !== undefined) return cached as T;

  let isArray: boolean;
  let prototype: object | null;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    return invalidSecurityConfig();
  }

  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return invalidSecurityConfig();
  }

  state.active.add(source);
  try {
    if (isArray) {
      let keys: (string | symbol)[];
      let length: unknown;
      try {
        keys = Reflect.ownKeys(source);
        const lengthDescriptor = Object.getOwnPropertyDescriptor(source, "length");
        length = lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value
          : undefined;
      } catch {
        return invalidSecurityConfig();
      }
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_SECURITY_CONFIG_ARRAY_LENGTH ||
        keys.length !== length + 1
      ) {
        return invalidSecurityConfig();
      }

      const clone = new Array<unknown>(length);
      state.clones.set(source, clone);
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (!descriptor || !("value" in descriptor)) return invalidSecurityConfig();
        consumeSecurityEntry(state);
        clone[index] = cloneAndFreezeSecurityValue(descriptor.value, state, depth + 1);
      }
      return Object.freeze(clone) as T;
    }

    let keys: (string | symbol)[];
    try {
      keys = Reflect.ownKeys(source);
    } catch {
      return invalidSecurityConfig();
    }
    const clone: Record<string, unknown> = Object.create(null);
    state.clones.set(source, clone);
    for (const key of keys) {
      if (typeof key !== "string") return invalidSecurityConfig();
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return invalidSecurityConfig();
      }
      consumeSecurityEntry(state);
      Object.defineProperty(clone, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: cloneAndFreezeSecurityValue(descriptor.value, state, depth + 1),
      });
    }
    return Object.freeze(clone) as T;
  } finally {
    state.active.delete(source);
  }
}

function readSecurityConfig(cfg: unknown): SecurityConfig | undefined {
  if (cfg === undefined) return undefined;
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    return invalidSecurityConfig();
  }

  try {
    const prototype = Object.getPrototypeOf(cfg);
    if (prototype !== Object.prototype && prototype !== null) return invalidSecurityConfig();
    const descriptor = Object.getOwnPropertyDescriptor(cfg, "security");
    if (!descriptor) return undefined;
    if (!descriptor.enumerable || !("value" in descriptor)) return invalidSecurityConfig();
    const value = descriptor.value;
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return invalidSecurityConfig();
    }
    return value as SecurityConfig;
  } catch {
    return invalidSecurityConfig();
  }
}

function readProductionDefaults(options: unknown): boolean | undefined {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return invalidSecurityConfig();
  }

  try {
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) return invalidSecurityConfig();
    // Allowlisted rather than ignored: this object reaches a security decision,
    // so an unrecognised key is a caller mistake worth failing on, not a
    // silently discarded one.
    const allowed = new Set<PropertyKey>(["productionDefaults", "derivedCsp"]);
    const keys = Reflect.ownKeys(options);
    if (keys.some((key) => !allowed.has(key))) return invalidSecurityConfig();
    const descriptor = Object.getOwnPropertyDescriptor(options, "productionDefaults");
    if (!descriptor) return undefined;
    if (!descriptor.enumerable || !("value" in descriptor)) return invalidSecurityConfig();
    if (descriptor.value !== undefined && typeof descriptor.value !== "boolean") {
      return invalidSecurityConfig();
    }
    return descriptor.value as boolean | undefined;
  } catch {
    return invalidSecurityConfig();
  }
}

/**
 * Check a standalone security configuration against the canonical project
 * configuration schema.
 *
 * @deprecated Project configuration loaded through `getConfig()` is already
 * validated. Prefer that validated configuration or `SecurityConfigLoader`.
 */
export function isValidSecurityConfig(config: unknown): config is SecurityConfig {
  try {
    const snapshot = cloneAndFreezeSecurityValue(config);
    return validateVeryfrontConfig({ security: snapshot }).security !== undefined;
  } catch {
    return false;
  }
}

/**
 * Load the project's schema-validated security configuration.
 *
 * Unlike the historical implementation, configuration loading and validation
 * failures are propagated so callers cannot silently continue without the
 * configured security policy. `null` means that the project has no security
 * configuration.
 *
 * @deprecated Use `SecurityConfigLoader` to derive the runtime security
 * context, including production defaults and the serialized CSP header.
 */
export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<SecurityConfig | null> {
  const config = await getConfig(projectDir, adapter);
  const security = readSecurityConfig(config);
  return security === undefined ? null : cloneAndFreezeSecurityValue(security);
}

/**
 * Derive a request-owned security context from schema-validated project config.
 *
 * Config objects can be cached and shared between projects or requests. Deep
 * cloning and freezing here prevents a handler from mutating that shared
 * source. Function-valued origin validators are wrapped in request-owned
 * frozen callables so mutable function objects are not shared across requests.
 */
export function deriveSecurityContext(
  cfg?: VeryfrontConfig,
  options: DeriveSecurityContextOptions = {},
): DerivedSecurityContext {
  const source = readSecurityConfig(cfg);
  const snapshot = source === undefined
    ? Object.freeze(Object.create(null)) as SecurityConfig
    : cloneAndFreezeSecurityValue(source);
  const normalized: SecurityConfig = Object.assign(Object.create(null), snapshot);
  normalized.cors ??= false;

  const productionDefaults = readProductionDefaults(options) ?? isProduction();
  if (normalized.csrf === undefined && productionDefaults) {
    normalized.csrf = true;
  }

  // Assigned unconditionally, never merged. `SecurityConfig` carries an index
  // signature, so the clone above would happily copy a `derivedCsp` a project
  // wrote in its own config; overwriting here makes the platform the only
  // author of this layer. Deleting when absent keeps a stale project value
  // from surviving as the derived set.
  if (options.derivedCsp && Object.keys(options.derivedCsp).length > 0) {
    normalized.derivedCsp = options.derivedCsp;
  } else {
    delete normalized.derivedCsp;
  }

  const securityConfig = Object.freeze(normalized);
  return Object.freeze({
    securityConfig,
  });
}

export class SecurityConfigLoader {
  private securityConfig: SecurityConfig | null = null;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private configOverride?: VeryfrontConfig,
    private productionRuntime = false,
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    const loadPromise = this.load();
    this.loadPromise = loadPromise;

    try {
      await loadPromise;
    } catch (error) {
      // Fail this request closed, but allow a later request to retry after a
      // transient filesystem, import, or parse failure.
      if (Object.is(this.loadPromise, loadPromise)) this.loadPromise = null;
      // Configuration errors can contain project paths or source fragments.
      // Keep process telemetry stable and non-sensitive; the error still
      // rejects the current caller unchanged for the request error boundary.
      logger.error("Failed to load security config; will retry on next request");
      throw error;
    }
  }

  private async load(): Promise<void> {
    const cfg = this.configOverride ?? (await getConfig(this.projectDir, this.adapter));
    this.applyConfig(cfg);
  }

  private applyConfig(cfg?: VeryfrontConfig): void {
    const production = this.productionRuntime || isProduction();
    const derived = deriveSecurityContext(cfg, { productionDefaults: production });
    const security = derived.securityConfig;

    if (production && !security.cors && !security.csrf) {
      logger.warn(
        "Neither CORS nor CSRF protection is configured. " +
          "CORS is disabled by default (same-origin only). " +
          "Consider explicitly configuring security.cors and security.csrf.",
      );
    }

    this.securityConfig = security;
    this.isLoaded = true;
  }

  getSecurityConfig(): SecurityConfig | null {
    return this.securityConfig;
  }

  getCorsConfig(): SecurityConfig["cors"] {
    return this.securityConfig?.cors;
  }

  buildCsp(isDev: boolean, nonce: string = generateNonce()): string {
    return buildCSP(isDev, nonce, this.securityConfig, this.adapter);
  }

  getSecurityHeader(headerName: string, defaultValue: string): string {
    const configKey = headerName.toLowerCase() as keyof SecurityConfig;
    const configValue = this.securityConfig?.[configKey];
    const envValue = this.adapter.env.get(`VERYFRONT_${headerName}`);

    if (typeof configValue === "string") return configValue;
    return envValue || defaultValue;
  }
}
