import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SecurityConfig } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getConfig } from "#veryfront/config";
import { serverLogger } from "#veryfront/utils";
import { buildCSP, generateNonce } from "./response/security-handler.ts";

const log = serverLogger.component("security-config-loader");

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

    this.loadPromise = this.load();
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    try {
      const cfg = this.configOverride ?? (await getConfig(this.projectDir, this.adapter));
      this.applyConfig(cfg);
    } catch (error) {
      // Config is optional, so we don't throw
      log.debug("Failed to load config:", error);
      this.isLoaded = true; // Mark as loaded even on error to prevent retry
    }
  }

  private applyConfig(cfg?: VeryfrontConfig): void {
    const security: SecurityConfig = cfg?.security ? { ...cfg.security } : {};

    if (security.headers) security.headers = { ...security.headers };

    security.cors ??= true;

    this.securityConfig = security;
    this.cspUserHeader = this.parseCspUserHeader(security.csp);
    this.isLoaded = true;
  }

  private parseCspUserHeader(csp: SecurityConfig["csp"]): string | null {
    if (!csp || typeof csp !== "object") return null;

    const pieces: string[] = [];

    for (const [k, v] of Object.entries(csp)) {
      if (v === undefined) continue;

      const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      pieces.push(`${key} ${val}`);
    }

    return pieces.length ? pieces.join("; ") : null;
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
