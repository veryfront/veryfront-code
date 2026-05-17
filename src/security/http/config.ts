import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SecurityConfig } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getConfig } from "#veryfront/config";
import { serverLogger } from "#veryfront/utils";
import { buildCSP, generateNonce, serializeCSPDirectives } from "./response/security-handler.ts";
import { isProduction } from "#veryfront/platform/environment.ts";

const logger = serverLogger.component("security-config-loader");

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
      logger.debug("Failed to load config", { error });
      this.isLoaded = true; // Mark as loaded even on error to prevent retry
    }
  }

  private applyConfig(cfg?: VeryfrontConfig): void {
    const security: SecurityConfig = cfg?.security ? { ...cfg.security } as SecurityConfig : {};

    if (security.headers) security.headers = { ...security.headers };

    security.cors ??= false;
    if (security.csrf === undefined && isProduction()) {
      security.csrf = true;
    }

    if (!security.cors && !security.csrf) {
      logger.warn(
        "Neither CORS nor CSRF protection is configured. " +
          "CORS is disabled by default (same-origin only). " +
          "Consider explicitly configuring security.cors and security.csrf.",
      );
    }

    this.securityConfig = security;
    this.cspUserHeader = serializeCSPDirectives(security.csp);
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
