/**
 * Bridge Configuration
 *
 * Reads config from window.__VF_BRIDGE_CONFIG__ (injected by the server)
 * and provides typed access to bridge options.
 */

export interface BridgeConfig {
  projectId: string;
  pageId: string;
  pagePath: string;
  wsUrl: string;
  yjsGuid: string;
  debugSkipInit: boolean;
  debugExposeInternals: boolean;
}

let config: BridgeConfig | null = null;

export function initConfig(): void {
  const raw = (window as any).__VF_BRIDGE_CONFIG__;
  if (!raw || typeof raw !== "object") {
    console.warn("[StudioBridge] No bridge config found on window.__VF_BRIDGE_CONFIG__");
    config = {
      projectId: "",
      pageId: "",
      pagePath: "",
      wsUrl: "",
      yjsGuid: "",
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

/** Set config directly (for tests only). */
export function setConfigForTest(override: Partial<BridgeConfig>): void {
  config = {
    projectId: "",
    pageId: "",
    pagePath: "",
    wsUrl: "",
    yjsGuid: "",
    debugSkipInit: false,
    debugExposeInternals: false,
    ...override,
  };
}
