/**
 * Bridge Configuration
 *
 * Reads config from window.__VF_BRIDGE_CONFIG__ (injected by the server)
 * and provides typed access to bridge options.
 */

import { logger } from "./bridge-logger.ts";

export type StudioMode = "simple" | "advanced";

export interface BridgeConfig {
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

export function initConfig(): void {
  // deno-lint-ignore no-explicit-any -- accessing injected global property
  const raw = (window as any).__VF_BRIDGE_CONFIG__;

  // studioMode can come from the injected config or from a query parameter
  // (Studio sets vf_studio_mode on the iframe URL).
  const params = new URLSearchParams(window.location.search);
  const qsMode = params.get("vf_studio_mode");
  const resolveMode = (value: unknown): StudioMode =>
    value === "simple" || qsMode === "simple" ? "simple" : "advanced";

  if (!raw || typeof raw !== "object") {
    logger.warn("No bridge config found on window.__VF_BRIDGE_CONFIG__");
    config = {
      projectId: "",
      pageId: "",
      pagePath: "",
      wsUrl: "",
      yjsGuid: "",
      studioMode: resolveMode(undefined),
      debugSkipInit: false,
      debugExposeInternals: false,
    };
    return;
  }
  config = {
    projectId: raw.projectId ?? "",
    pageId: raw.pageId ?? "",
    pagePath: raw.pagePath ?? raw.pageId ?? "",
    wsUrl: raw.wsUrl ?? "",
    yjsGuid: raw.yjsGuid ?? "",
    studioMode: resolveMode(raw.studioMode),
    debugSkipInit: !!raw.debugSkipInit,
    debugExposeInternals: !!raw.debugExposeInternals,
  };
}

export function getConfig(): BridgeConfig {
  if (!config) {
    throw new Error("[StudioBridge] Config not initialized. Call initConfig() first.");
  }
  return config;
}

export function isMarkdownPage(): boolean {
  const cfg = getConfig();
  if (typeof cfg.pagePath !== "string") {
    return false;
  }
  const lowerPath = cfg.pagePath.toLowerCase();
  return lowerPath.endsWith(".md") || lowerPath.endsWith(".mdx");
}

export function isMdxPage(): boolean {
  const cfg = getConfig();
  return typeof cfg.pagePath === "string" && cfg.pagePath.toLowerCase().endsWith(".mdx");
}

/** Set config directly (for tests only). */
export function setConfigForTest(override: Partial<BridgeConfig>): void {
  config = {
    projectId: "",
    pageId: "",
    pagePath: "",
    wsUrl: "",
    yjsGuid: "",
    studioMode: "advanced",
    debugSkipInit: false,
    debugExposeInternals: false,
    ...override,
  };
}
