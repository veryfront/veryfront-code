/**
 * Security Configuration Loader
 * Loads and caches security configuration from veryfront.config.ts
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { SecurityConfig } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { getConfig } from "@veryfront/config";
import { serverLogger } from "@veryfront/utils";
import { buildCSP, generateNonce } from "./response/security-handler.ts";

export class SecurityConfigLoader {
  private securityConfig: SecurityConfig | null = null;
  private cspUserHeader: string | null = null;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private configOverride?: VeryfrontConfig;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    configOverride?: VeryfrontConfig,
  ) {
    this.configOverride = configOverride;
  }

  /**
   * Ensure security config is loaded (singleton pattern)
   */
  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    // If already loading, wait for it
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // Start loading
    this.loadPromise = this.load();
    await this.loadPromise;
  }

  /**
   * Load security configuration
   */
  private async load(): Promise<void> {
    try {
      const cfg = this.configOverride ??
        await getConfig(this.projectDir, this.adapter) as VeryfrontConfig;
      this.applyConfig(cfg);
    } catch (error) {
      // Config is optional, so we don't throw
      serverLogger.debug("[SecurityConfigLoader] Failed to load config:", error);
      this.isLoaded = true; // Mark as loaded even on error to prevent retry
    }
  }

  private applyConfig(cfg?: VeryfrontConfig): void {
    const baseSecurity = cfg?.security
      ? { ...cfg.security } as SecurityConfig
      : {} as SecurityConfig;

    if (baseSecurity.headers) {
      baseSecurity.headers = { ...baseSecurity.headers };
    }

    if (baseSecurity.cors === undefined) {
      baseSecurity.cors = true;
    }

    this.securityConfig = baseSecurity;
    this.cspUserHeader = null;

    // Parse CSP from config
    const cfgCsp = this.securityConfig?.csp;
    if (cfgCsp && typeof cfgCsp === "object") {
      const pieces: string[] = [];
      for (const [k, v] of Object.entries(cfgCsp)) {
        if (v === undefined) continue;
        const key = String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        const val = Array.isArray(v) ? v.join(" ") : String(v);
        pieces.push(`${key} ${val}`);
      }
      if (pieces.length > 0) {
        this.cspUserHeader = pieces.join("; ");
      }
    }

    this.isLoaded = true;
  }

  /**
   * Get security configuration
   */
  getSecurityConfig(): SecurityConfig | null {
    return this.securityConfig;
  }

  /**
   * Get CSP header from config
   */
  getCspUserHeader(): string | null {
    return this.cspUserHeader;
  }

  /**
   * Get CORS configuration
   */
  getCorsConfig(): SecurityConfig["cors"] {
    return this.securityConfig?.cors;
  }

  /**
   * Build complete CSP header
   */
  buildCsp(isDev: boolean, nonce: string = generateNonce()): string {
    return buildCSP(
      isDev,
      nonce,
      this.cspUserHeader,
      this.securityConfig,
      this.adapter,
    );
  }

  /**
   * Get security header value
   */
  getSecurityHeader(headerName: string, defaultValue: string): string {
    const configKey = headerName.toLowerCase();
    const configValue = this.securityConfig?.[configKey as keyof SecurityConfig];
    const envValue = this.adapter.env.get(`VERYFRONT_${headerName}`);
    return (typeof configValue === "string" ? configValue : undefined) || envValue || defaultValue;
  }

  /**
   * Reset the loader (mainly for testing)
   */
  reset(): void {
    this.securityConfig = null;
    this.cspUserHeader = null;
    this.isLoaded = false;
    this.loadPromise = null;
  }
}
