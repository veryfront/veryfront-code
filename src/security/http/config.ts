import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SecurityConfig } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getConfig } from "#veryfront/config";
import { serverLogger } from "#veryfront/utils";
import { buildCSP, generateNonce, serializeCSPDirectives } from "./response/security-handler.ts";
import { isProduction } from "#veryfront/platform/environment.ts";

const logger = serverLogger.component("security-config-loader");

export interface DerivedSecurityContext {
  securityConfig: SecurityConfig;
  cspUserHeader: string | null;
}

export interface DeriveSecurityContextOptions {
  /**
   * Apply security defaults used by production runtimes. Defaults to the
   * process environment; callers with an independently trusted runtime
   * classification may override it explicitly.
   */
  productionDefaults?: boolean;
}

function cloneAndFreezeSecurityValue<T>(
  value: T,
  seen: WeakMap<object, unknown> = new WeakMap(),
): T {
  if (value === null) return value;

  if (typeof value === "function") {
    const source = value as (...args: unknown[]) => unknown;
    const cached = seen.get(source);
    if (cached !== undefined) return cached as T;

    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      return Reflect.apply(source, this, args);
    };
    seen.set(source, wrapped);
    return Object.freeze(wrapped) as T;
  }

  if (typeof value !== "object") return value;

  const source = value as object;
  const cached = seen.get(source);
  if (cached !== undefined) return cached as T;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(source, clone);
    for (const item of value) clone.push(cloneAndFreezeSecurityValue(item, seen));
    return Object.freeze(clone) as T;
  }

  const clone: Record<string, unknown> = {};
  seen.set(source, clone);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = cloneAndFreezeSecurityValue(child, seen);
  }
  return Object.freeze(clone) as T;
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
  const source = cfg?.security as SecurityConfig | undefined;
  const normalized: SecurityConfig = source ? { ...source } : {};
  normalized.cors ??= false;

  const productionDefaults = options.productionDefaults ?? isProduction();
  if (normalized.csrf === undefined && productionDefaults) {
    normalized.csrf = true;
  }

  const securityConfig = cloneAndFreezeSecurityValue(normalized);
  return Object.freeze({
    securityConfig,
    cspUserHeader: serializeCSPDirectives(securityConfig.csp),
  });
}

export class SecurityConfigLoader {
  private securityConfig: SecurityConfig | null = null;
  private cspUserHeader: string | null = null;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private configOverride?: VeryfrontConfig,
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
      logger.error("Failed to load security config; will retry on next request", { error });
      throw error;
    }
  }

  private async load(): Promise<void> {
    const cfg = this.configOverride ?? (await getConfig(this.projectDir, this.adapter));
    this.applyConfig(cfg);
  }

  private applyConfig(cfg?: VeryfrontConfig): void {
    const derived = deriveSecurityContext(cfg);
    const security = derived.securityConfig;

    if (!security.cors && !security.csrf) {
      logger.warn(
        "Neither CORS nor CSRF protection is configured. " +
          "CORS is disabled by default (same-origin only). " +
          "Consider explicitly configuring security.cors and security.csrf.",
      );
    }

    this.securityConfig = security;
    this.cspUserHeader = derived.cspUserHeader;
    this.isLoaded = true;
  }

  getSecurityConfig(): SecurityConfig | null {
    return this.securityConfig;
  }

  getCspUserHeader(): string | null {
    return this.cspUserHeader;
  }

  getCorsConfig(): SecurityConfig["cors"] {
    return this.securityConfig?.cors;
  }

  buildCsp(isDev: boolean, nonce: string = generateNonce()): string {
    return buildCSP(isDev, nonce, this.cspUserHeader, this.securityConfig, this.adapter);
  }

  getSecurityHeader(headerName: string, defaultValue: string): string {
    const configKey = headerName.toLowerCase() as keyof SecurityConfig;
    const configValue = this.securityConfig?.[configKey];
    const envValue = this.adapter.env.get(`VERYFRONT_${headerName}`);

    if (typeof configValue === "string") return configValue;
    return envValue || defaultValue;
  }

  reset(): void {
    this.securityConfig = null;
    this.cspUserHeader = null;
    this.isLoaded = false;
    this.loadPromise = null;
  }
}
