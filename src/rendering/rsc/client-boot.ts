/**
 * Client boot script for RSC hydration and streaming
 * This file is bundled by esbuild at runtime and served as client.js
 */

import type { ClientModuleStrategy } from "./client-module-strategy.ts";
import {
  buildClientModuleUrl,
  type ClientRuntimeHydrationData,
  getHydrationReactImportSpecifiers,
  readHydrationData,
  resolveClientModuleStrategy,
} from "./client-module-strategy.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { consumeNdjsonStream, getContainer } from "./client-dom.ts";
import { hydrateAllClientBoundaries } from "./hydrate-client.ts";
import { wrapWithRouterProvider } from "./hydration-router.ts";
import { RSC_PATH_PREFIX, RSC_ROOT_ID } from "./constants.ts";

/**
 * Import React using the page's import map when available.
 * When the document does not own the React specifiers, use explicit CDN URLs.
 */
async function importReact(): Promise<
  { React: typeof import("react"); ReactDOM: typeof import("react-dom/client") }
> {
  const hydrationData = readHydrationData(document);
  const specifiers = getHydrationReactImportSpecifiers(
    document,
    hydrationData?.reactVersion,
  );
  const [React, ReactDOM] = await Promise.all([
    import(specifiers.react),
    import(specifiers.reactDomClient),
  ]);
  return { React, ReactDOM };
}

interface HydrationRootCandidate {
  tagName: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}

const NON_HYDRATABLE_ROOT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

function isHiddenHydrationPlaceholder(element: HydrationRootCandidate): boolean {
  const style = element.getAttribute("style") ?? "";
  return element.hasAttribute("data-veryfront-head") ||
    element.hasAttribute("hidden") ||
    /(?:^|;)\s*display\s*:\s*none(?:\s*;|$)/i.test(style) ||
    NON_HYDRATABLE_ROOT_TAGS.has(element.tagName.toUpperCase());
}

export function selectHydrationRoot<T extends HydrationRootCandidate>(
  children: readonly T[],
  fallback: T,
): T {
  return children.find((element) =>
    element.tagName.toUpperCase() === "DIV" &&
    !!element.getAttribute("class")?.trim() &&
    !isHiddenHydrationPlaceholder(element)
  ) ?? fallback;
}

export function shouldWrapPageHydrationRoot<T>(root: T, fallback: T): boolean {
  return root === fallback;
}

function createPageHydrationRoot(
  children: readonly Element[],
  fallback: HTMLElement,
): HTMLElement {
  const mount = document.createElement("div");
  mount.setAttribute("data-veryfront-hydration-root", "page");

  const firstRenderable = children.find((element) => !isHiddenHydrationPlaceholder(element));
  if (firstRenderable?.parentNode === fallback) {
    fallback.insertBefore(mount, firstRenderable);
  } else {
    fallback.appendChild(mount);
  }

  for (const element of children) {
    if (!isHiddenHydrationPlaceholder(element) && element.parentNode === fallback) {
      mount.appendChild(element);
    }
  }

  return mount;
}

interface RSCBootDocument {
  getElementById(id: string): Element | null;
}

interface PageRendererWindow {
  __veryfrontRenderPage?: unknown;
}

export function shouldUsePageRendererHydration(
  win: PageRendererWindow | undefined,
  hydrationData: ClientRuntimeHydrationData | null,
  doc: RSCBootDocument = document,
): boolean {
  return !!hydrationData?.pagePath &&
    typeof win?.__veryfrontRenderPage === "function" &&
    !!doc.getElementById("root");
}

export function shouldAttemptRSCTransport(
  doc: RSCBootDocument,
  hydrationData: ClientRuntimeHydrationData | null,
): boolean {
  if (hydrationData?.pagePath) return false;
  return !!doc.getElementById(RSC_ROOT_ID);
}

export function shouldHydrateOnly(importUrl: string = import.meta.url): boolean {
  try {
    return new URL(importUrl, "http://veryfront.local").searchParams.get("hydrate") === "1";
  } catch (_) {
    return false;
  }
}

export function shouldRenderPageComponent(strategy: ClientModuleStrategy): boolean {
  return strategy === "rsc-module";
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
    await hydrateAllClientBoundaries(document);
  } catch (e) {
    console.debug?.("[RSC] hydration failed", e);
  }
}

async function hydratePageComponent(
  pagePath: string,
  strategy: ClientModuleStrategy,
): Promise<boolean> {
  try {
    const { React, ReactDOM } = await importReact();
    const moduleUrl = buildClientModuleUrl({
      strategy,
      rel: pagePath,
    });
    if (!moduleUrl) return false;
    console.debug?.("[RSC] Loading component from:", moduleUrl);

    const mod = await import(moduleUrl);
    const Component = mod.default;

    if (typeof Component !== "function") {
      console.debug?.("[RSC] Page component is not a function");
      return false;
    }

    const bodyChildren = Array.from(document.body.children);
    const root = selectHydrationRoot(bodyChildren, document.body);
    const hydrationRoot = shouldWrapPageHydrationRoot(root, document.body)
      ? createPageHydrationRoot(bodyChildren, document.body)
      : root;
    const component = await wrapWithRouterProvider(
      React.createElement(Component, {}),
      readHydrationData(document),
    );

    if (shouldRenderPageComponent(strategy)) {
      ReactDOM.createRoot(hydrationRoot).render(component);
    } else {
      ReactDOM.hydrateRoot(hydrationRoot, component, {
        identifierPrefix: "vf",
        onRecoverableError: () => {},
      });
    }

    console.debug?.("[RSC] Page component hydrated successfully");
    return true;
  } catch (e) {
    console.error("[RSC] Page hydration failed", e);
    return false;
  }
}

async function applyPayload(q: string): Promise<boolean> {
  try {
    const res = await fetch(RSC_PATH_PREFIX + "payload" + q);
    if (!res.ok) return false;

    const data = await res.json();

    if (data?.slots) {
      for (const [id, html] of Object.entries(data.slots)) {
        getContainer(document, id).innerHTML = validateTrustedHtml(String(html || ""));
      }
      return true;
    }

    getContainer(document, RSC_ROOT_ID).innerHTML = validateTrustedHtml(String(data?.html || ""));
    return true;
  } catch (e) {
    console.debug?.("[RSC] payload fetch failed", e);
    return false;
  }
}

export async function boot(): Promise<void> {
  try {
    const q = globalThis.window?.location.search ?? "";
    const hydrationData = readHydrationData(document);
    if (shouldHydrateOnly()) {
      await hydrateMarkers();
      return;
    }

    const pagePath = hydrationData?.pagePath;
    const clientModuleStrategy = resolveClientModuleStrategy(hydrationData);
    if (pagePath) {
      if (
        shouldUsePageRendererHydration(
          globalThis.window as PageRendererWindow,
          hydrationData,
          document,
        )
      ) {
        console.debug?.("[RSC] Page renderer owns hydration");
        return;
      }
      console.debug?.("[RSC] Found page component in hydration data:", pagePath);
      if (await hydratePageComponent(pagePath, clientModuleStrategy)) {
        console.debug?.("[RSC] Client component hydrated successfully");
      }
      return;
    }

    if (!shouldAttemptRSCTransport(document, hydrationData)) {
      return;
    }

    if (await tryStream(q)) {
      await hydrateMarkers();
      return;
    }

    if (await applyPayload(q)) {
      await hydrateMarkers();
      return;
    }

    await hydrateMarkers();
  } catch (e) {
    console.error("[RSC] boot failed", e);
  }
}

if (typeof document !== "undefined") {
  const run = (): void => {
    void boot();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
