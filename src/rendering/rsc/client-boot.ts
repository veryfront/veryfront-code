
import {
  getReactCDNUrl,
  getReactDOMClientCDNUrl,
  REACT_DEFAULT_VERSION,
} from "@veryfront/utils/constants/cdn.ts";
import { consumeNdjsonStream, getContainer } from "./client-dom.ts";
import { FS_PATH_PREFIX, HYDRATION_DATA_ID, RSC_PATH_PREFIX, RSC_ROOT_ID } from "./constants.ts";

function toBase64Url(str: string): string | null {
  try {
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/\+/g, "-").replace(/\
  } catch (e) {
    console.debug?.("[RSC] toBase64Url failed", e);
    return null;
  }
}

function getHydrationData(): { pagePath?: string } | null {
  try {
    const el = document.getElementById(HYDRATION_DATA_ID);
    if (!el) return null;
    return JSON.parse(el.textContent || "{}");
  } catch (e) {
    console.debug?.("[RSC] hydration data parse failed", e);
    return null;
  }
}

async function tryStream(q: string): Promise<boolean> {
  try {
    const res = await fetch(RSC_PATH_PREFIX + "stream" + q);
    if (!res.ok || !res.body) return false;
    const ctrl = new AbortController();
    addEventListener("pagehide", () => ctrl.abort(), { once: true });
    await consumeNdjsonStream(res, document, ctrl.signal);
    return true;
  } catch (e) {
    console.debug?.("[RSC] tryStream failed", e);
    return false;
  }
}

async function hydrateMarkers(): Promise<void> {
  try {
    const mod = await import(RSC_PATH_PREFIX + "hydrate.js");
    mod.bootHydration?.();
  } catch (e) {
    console.debug?.("[RSC] hydrate import failed", e);
  }
}

async function hydratePageComponent(pagePath: string): Promise<boolean> {
  try {
    const React = await import(getReactCDNUrl(REACT_DEFAULT_VERSION));
    const ReactDOM = await import(
      getReactDOMClientCDNUrl(REACT_DEFAULT_VERSION)
    );

    const base64Path = toBase64Url(pagePath);
    if (!base64Path) {
      console.debug?.("[RSC] Failed to encode page path");
      return false;
    }
    const moduleUrl = FS_PATH_PREFIX + base64Path + ".js";

    console.debug?.("[RSC] Loading component from:", moduleUrl);

    const mod = await import(moduleUrl);
    const Component = mod.default;

    if (typeof Component !== "function") {
      console.debug?.("[RSC] Page component is not a function");
      return false;
    }

    const root = document.body.querySelector("div[class]") ||
      document.body.firstElementChild ||
      document.body;

    ReactDOM.hydrateRoot(root, React.createElement(Component, {}));
    console.debug?.("[RSC] Page component hydrated successfully");
    return true;
  } catch (e) {
    console.error("[RSC] Page hydration failed", e);
    return false;
  }
}

export async function boot(): Promise<void> {
  try {
    const q = globalThis.window?.location.search || "";

    const hydrationData = getHydrationData();
    if (hydrationData && hydrationData.pagePath) {
      console.debug?.(
        "[RSC] Found page component in hydration data:",
        hydrationData.pagePath,
      );
      const hydrated = await hydratePageComponent(hydrationData.pagePath);
      if (hydrated) {
        console.debug?.("[RSC] Client component hydrated successfully");
        return;
      }
    }

    const streamed = await tryStream(q);
    if (streamed) {
      await hydrateMarkers();
      return;
    }

    try {
      const res = await fetch(RSC_PATH_PREFIX + "payload" + q);
      if (res.ok) {
        const data = await res.json();
        if (data && data.slots) {
          for (const [id, html] of Object.entries(data.slots)) {
            const el = getContainer(document, id);
            el.innerHTML = String(html || "");
          }
        } else {
          const el = getContainer(document, RSC_ROOT_ID);
          el.innerHTML = String(data.html || "");
        }
        await hydrateMarkers();
        return;
      }
    } catch (e) {
      console.debug?.("[RSC] payload fetch failed", e);
    }

    await hydrateMarkers();
  } catch (e) {
    console.error("[RSC] boot failed", e);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot());
  } else {
    boot();
  }
}
