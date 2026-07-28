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
import { rscLogger } from "../client/browser-logger.ts";
import {
  createClientRequestLifetime,
  isValidRscSlotId,
  MAX_RSC_CLIENT_SLOTS,
  readJsonResponseWithinLimit,
} from "./client-transport.ts";
import { HEAD_REACT_OWNER_ATTRIBUTE } from "#veryfront/html/managed-head-protocol.ts";

const MAX_RSC_PAYLOAD_RESPONSE_BYTES = 2 * 1024 * 1024;

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

/**
 * Remove server Head placeholders that sit outside the root React will own.
 * They cannot ever register with the client manager (the fallback-root path
 * deliberately leaves hidden siblings behind), so retaining them would keep
 * selective-hydration cleanup blocked forever.
 */
export function retireAbandonedHeadOwnerMarkers(
  previousBodyChildren: readonly Element[],
  hydrationRoot: Element,
): void {
  for (const child of previousBodyChildren) {
    const candidates = [
      ...(child.hasAttribute(HEAD_REACT_OWNER_ATTRIBUTE) ? [child] : []),
      ...child.querySelectorAll(`[${HEAD_REACT_OWNER_ATTRIBUTE}]`),
    ];
    for (const marker of candidates) {
      if (!hydrationRoot.contains(marker)) marker.remove();
    }
  }
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
  const lifetime = createClientRequestLifetime();
  try {
    const res = await fetch(RSC_PATH_PREFIX + "stream" + q, {
      headers: { Accept: "application/x-ndjson" },
      signal: lifetime.signal,
    });
    if (!res.ok || !res.body) {
      try {
        await res.body?.cancel();
      } catch {
        // The request lifetime may already have cancelled the body.
      }
      return false;
    }

    await consumeNdjsonStream(res, document, lifetime.signal);
    return true;
  } catch (e) {
    rscLogger.debug("tryStream failed", e);
    return false;
  } finally {
    lifetime.dispose();
  }
}

async function hydrateMarkers(): Promise<void> {
  try {
    await hydrateAllClientBoundaries(document);
  } catch (e) {
    rscLogger.debug("hydration failed", e);
  }
}

async function hydratePageComponent(
  pagePath: string,
  strategy: ClientModuleStrategy,
  hydrationData: ClientRuntimeHydrationData | null,
): Promise<boolean> {
  try {
    const { React, ReactDOM } = await importReact();
    const moduleUrl = buildClientModuleUrl({
      strategy,
      rel: pagePath,
      releaseAssetModules: hydrationData?.releaseAssetModules,
    });
    if (!moduleUrl) return false;
    rscLogger.debug("Loading component from:", moduleUrl);

    const mod = await import(moduleUrl);
    const Component = mod.default;

    if (typeof Component !== "function") {
      rscLogger.debug("Page component is not a function");
      return false;
    }

    const bodyChildren = Array.from(document.body.children);
    const root = selectHydrationRoot(bodyChildren, document.body);
    const hydrationRoot = shouldWrapPageHydrationRoot(root, document.body)
      ? createPageHydrationRoot(bodyChildren, document.body)
      : root;
    retireAbandonedHeadOwnerMarkers(bodyChildren, hydrationRoot);
    const component = await wrapWithRouterProvider(
      React.createElement(Component, {}),
      hydrationData,
    );

    if (shouldRenderPageComponent(strategy)) {
      ReactDOM.createRoot(hydrationRoot).render(component);
    } else {
      ReactDOM.hydrateRoot(hydrationRoot, component, {
        identifierPrefix: "vf",
        onRecoverableError: () => {},
      });
    }

    rscLogger.debug("Page component hydrated successfully");
    return true;
  } catch (e) {
    rscLogger.error("Page hydration failed", e);
    return false;
  }
}

interface RscPayloadSlot {
  readonly id: string;
  readonly html: string;
}

function readPayloadSlots(value: unknown): readonly RscPayloadSlot[] | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_RSC_CLIENT_SLOTS) return null;

  const slots: RscPayloadSlot[] = [];
  for (const id of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, id);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !isValidRscSlotId(id) ||
      typeof descriptor.value !== "string"
    ) {
      return null;
    }
    slots.push({ id, html: descriptor.value });
  }
  return slots;
}

/**
 * Validate a complete payload before mutating any DOM container.
 */
export function applyRscPayload(doc: Document, value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (Object.hasOwn(payload, "slots")) {
    const slots = readPayloadSlots(payload.slots);
    if (!slots) return false;

    let admittedSlots: readonly RscPayloadSlot[];
    try {
      admittedSlots = slots.map(({ id, html }) => ({
        id,
        html: validateTrustedHtml(html),
      }));
    } catch {
      return false;
    }

    for (const { id, html } of admittedSlots) {
      getContainer(doc, id).innerHTML = html;
    }
    return true;
  }

  if (typeof payload.html !== "string") return false;
  try {
    getContainer(doc, "root").innerHTML = validateTrustedHtml(payload.html);
    return true;
  } catch {
    return false;
  }
}

async function applyPayload(q: string): Promise<boolean> {
  const lifetime = createClientRequestLifetime();
  try {
    const res = await fetch(RSC_PATH_PREFIX + "payload" + q, {
      headers: { Accept: "application/json" },
      signal: lifetime.signal,
    });
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // The request lifetime may already have cancelled the body.
      }
      return false;
    }

    const data = await readJsonResponseWithinLimit(
      res,
      MAX_RSC_PAYLOAD_RESPONSE_BYTES,
    );
    return applyRscPayload(document, data);
  } catch (e) {
    rscLogger.debug("payload fetch failed", e);
    return false;
  } finally {
    lifetime.dispose();
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
        rscLogger.debug("Page renderer owns hydration");
        return;
      }
      rscLogger.debug("Found page component in hydration data:", pagePath);
      if (await hydratePageComponent(pagePath, clientModuleStrategy, hydrationData)) {
        rscLogger.debug("Client component hydrated successfully");
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
    rscLogger.error("boot failed", e);
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
