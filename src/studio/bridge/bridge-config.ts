/**
 * Bridge Configuration
 *
 * Reads config from window.__VF_BRIDGE_CONFIG__ (injected by the server)
 * and provides typed access to bridge options.
 */

import { logger } from "./bridge-logger.ts";

export type StudioMode = "simple" | "advanced";

interface BridgeConfig {
  projectId: string;
  pageId: string;
  pagePath: string;
  wsUrl: string;
  yjsGuid: string;
  studioMode: StudioMode;
  debugSkipInit: boolean;
  debugExposeInternals: boolean;
}

let config: BridgeConfig | null = null;

const DEFAULT_CONFIG: BridgeConfig = {
  projectId: "",
  pageId: "",
  pagePath: "",
  wsUrl: "",
  yjsGuid: "",
  studioMode: "advanced",
  debugSkipInit: false,
  debugExposeInternals: false,
};

function resolveStudioMode(value: unknown, queryString: string): StudioMode {
  const params = new URLSearchParams(queryString);
  return value === "simple" || params.get("vf_studio_mode") === "simple" ? "simple" : "advanced";
}

function normalizeConfig(raw?: Record<string, unknown>): BridgeConfig {
  const queryString = window.location.search;

  if (!raw || typeof raw !== "object") {
    logger.warn("No bridge config found on window.__VF_BRIDGE_CONFIG__");
    return {
      ...DEFAULT_CONFIG,
      studioMode: resolveStudioMode(undefined, queryString),
    };
  }

  return {
    ...DEFAULT_CONFIG,
    projectId: String(raw.projectId ?? ""),
    pageId: String(raw.pageId ?? ""),
    pagePath: String(raw.pagePath ?? raw.pageId ?? ""),
    wsUrl: String(raw.wsUrl ?? ""),
    yjsGuid: String(raw.yjsGuid ?? ""),
    studioMode: resolveStudioMode(raw.studioMode, queryString),
    debugSkipInit: !!raw.debugSkipInit,
    debugExposeInternals: !!raw.debugExposeInternals,
  };
}

export function initConfig(): void {
  const raw: Record<string, unknown> | undefined = (globalThis as Record<string, unknown>)
    .__VF_BRIDGE_CONFIG__ as
      | Record<string, unknown>
      | undefined;
  config = normalizeConfig(raw);
}

export function getConfig(): BridgeConfig {
  if (!config) {
    throw new Error("[StudioBridge] Config not initialized. Call initConfig() first.");
  }
  return config;
}

/** Set config directly (for tests only). */
export function setConfigForTest(override: Partial<BridgeConfig>): void {
  config = {
    ...DEFAULT_CONFIG,
    ...override,
  };
}
