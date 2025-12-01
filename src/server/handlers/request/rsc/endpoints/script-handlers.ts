/**
 * Script endpoint handlers (client.js, dom.js)
 * @module rsc-endpoints/script-handlers
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { serverLogger } from "@veryfront/utils";
import {
  getReactCDNUrl,
  getReactDOMClientCDNUrl,
  REACT_DEFAULT_VERSION,
} from "@veryfront/utils/constants/cdn.ts";

/**
 * Handle client.js endpoint
 * @returns Response with client boot script
 */
export function handleClientScript(): Response {
  // Client boot script that:
  // 1. Reads hydration data from the page (contains exact pagePath)
  // 2. Attempts RSC streaming if available
  // 3. Falls back to direct React hydration for 'use client' pages
  const code = `import { getContainer, consumeNdjsonStream } from '/_veryfront/rsc/dom.js';

// Convert file path to base64url (matching server-side toBase64Url)
function toBase64Url(str) {
	try {
		const base64 = btoa(unescape(encodeURIComponent(str)));
		return base64
			.replace(/\\+/g, "-")
			.replace(/\\/ / g, "_")
			.replace(/=+$/, "");
	} catch (e) {
		console.debug?.("[RSC] toBase64Url failed", e);
		return null;
	}
}

// Get hydration data from the page
function getHydrationData() {
	try {
		const el = document.getElementById("veryfront-hydration-data");
		if (!el) return null;
		return JSON.parse(el.textContent || "{}");
	} catch (e) {
		console.debug?.("[RSC] hydration data parse failed", e);
		return null;
	}
}

// Try RSC streaming approach
async function tryStream(q) {
	try {
		const res = await fetch("/_veryfront/rsc/stream" + q);
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

// Hydrate using the hydrate.js script (for data-client-ref markers)
async function hydrateMarkers() {
	try {
		await import("/_veryfront/rsc/hydrate.js").then((m) => m.bootHydration?.());
	} catch (e) {
		console.debug?.("[RSC] hydrate import failed", e);
	}
}

// Direct React hydration for 'use client' page components
async function hydratePageComponent(pagePath) {
	try {
		// Import React and ReactDOM
		const React = await import("${getReactCDNUrl(REACT_DEFAULT_VERSION)}");
		const ReactDOM = await import("${getReactDOMClientCDNUrl(REACT_DEFAULT_VERSION)}");

		// Convert the page file path to the /_veryfront/fs/ URL format
		const base64Path = toBase64Url(pagePath);
		if (!base64Path) {
			console.debug?.("[RSC] Failed to encode page path");
			return false;
		}
		const moduleUrl = "/_veryfront/fs/" + base64Path + ".js";

		console.debug?.("[RSC] Loading component from:", moduleUrl);

		// Import the component module
		const mod = await import(moduleUrl);
		const Component = mod.default;

		if (typeof Component !== "function") {
			console.debug?.("[RSC] Page component is not a function");
			return false;
		}

		// Find the root element to hydrate
		// Look for body's first child div or the first child with content
		const root =
			document.body.querySelector("div[class]") ||
			document.body.firstElementChild ||
			document.body;

		// Use hydrateRoot for proper React hydration
		ReactDOM.hydrateRoot(root, React.createElement(Component, {}));
		console.debug?.("[RSC] Page component hydrated successfully");
		return true;
	} catch (e) {
		console.error("[RSC] Page hydration failed", e);
		return false;
	}
}

export async function boot() {
	try {
		const q = window.location.search || "";

		// FIRST: Check hydration data for the pagePath
		// This handles 'use client' pages that need direct React hydration
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

		// If no client page components, try RSC streaming for server components
		const streamed = await tryStream(q);
		if (streamed) {
			await hydrateMarkers();
			return;
		}

		// Try payload-based approach
		try {
			const res = await fetch("/_veryfront/rsc/payload" + q);
			if (res.ok) {
				const data = await res.json();
				if (data && data.slots) {
					for (const [id, html] of Object.entries(data.slots)) {
						const el = getContainer(document, id);
						el.innerHTML = String(html || "");
					}
				} else {
					const el = getContainer(document, "root");
					el.innerHTML = String(data.html || "");
				}
				await hydrateMarkers();
				return;
			}
		} catch (e) {
			console.debug?.("[RSC] payload fetch failed", e);
		}

		// Final fallback: just run marker-based hydration
		await hydrateMarkers();
	} catch (e) {
		console.error("[RSC] boot failed", e);
	}
}

// Auto-boot on DOM ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", boot);
} else {
	boot();
}
`;

  return new Response(code, {
    headers: { "content-type": "application/javascript" },
  });
}

/**
 * Handle dom.js endpoint - provides DOM utilities for RSC streaming
 * Inlined to avoid file system dependencies in npm package context
 * @returns Response with DOM utilities
 */
export async function handleDomScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const p = new URL(
    "../../../../../rendering/rsc/client-dom.ts",
    import.meta.url,
  ).pathname;
  let esbuild: typeof import("esbuild/mod.js") | null = null;
  try {
    // Use native esbuild for proper file system access during bundling
    // In npm build, this will be replaced by the injected bundle
    esbuild = await import("esbuild/mod.js");
    const src = await adapter.fs.readFile(p);
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      stdin: {
        contents: src,
        loader: "ts",
        resolveDir: p.substring(0, p.lastIndexOf("/")),
        sourcefile: p,
      },
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    return new Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    // Fallback for npm build where esbuild/fs might not be available
    // CLIENT_DOM_BUNDLE will be injected by the build script
    if (CLIENT_DOM_BUNDLE) {
      return new Response(CLIENT_DOM_BUNDLE, {
        headers: { "content-type": "application/javascript" },
      });
    }

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );
    const src = await adapter.fs.readFile(p);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    try {
      esbuild?.stop?.();
    } catch (stopError) {
      serverLogger.debug("[ScriptHandlers] esbuild stop failed", stopError);
    }
  }
}

// Placeholder for build-time injection
export const CLIENT_DOM_BUNDLE = "";
