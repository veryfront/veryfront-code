import { rendererLogger } from "#veryfront/utils";
import type { ClientRouteHeadEntry, PageData } from "./types.ts";
export {
  updateRouteMetaTags as updateMetaTags,
  updateRouteTitle,
} from "#veryfront/html/client-route-head.ts";
import {
  aggregateManagedHeadDescriptors,
  assertManagedHeadDescriptorBudget,
  descriptorFromManagedHeadRecord,
  deserializeManagedHeadPayload,
  HEAD_LEGACY_MANAGED_ATTRIBUTE,
  HEAD_PROVENANCE_ATTRIBUTE,
  HEAD_REACT_OWNER_ATTRIBUTE,
  HEAD_ROUTE_MANAGED_ATTRIBUTE,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  HEAD_SSR_PAYLOAD_ATTRIBUTE,
  headLinkSingletonKeyFromRecord,
  headMetaSingletonKeyFromRecord,
  isHeadFrameworkAttribute,
  type ManagedHeadDescriptor,
  managedHeadDescriptorToTransportEntry,
} from "#veryfront/html/managed-head-protocol.ts";
import {
  getManagedHeadNonce,
  retireClientHeadOwnership,
} from "#veryfront/html/client-head-manager.ts";

const logger = rendererLogger.component("veryfront");
const PARSED_ROUTE_HEAD_CONTENT_PROPERTY = "__veryfront_parsed_route_head_content";

export function isInternalLink(target: HTMLAnchorElement): boolean {
  const href = target.getAttribute("href");
  if (!href) return false;

  if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return false;

  const linkTarget = target.getAttribute("target");
  if (linkTarget === "_blank" || target.hasAttribute("download")) return false;

  return true;
}

export function findAnchorElement(element: HTMLElement | null): HTMLAnchorElement | null {
  let current: HTMLElement | null = element;

  while (current && current.tagName !== "A") {
    current = current.parentElement;
  }

  return current instanceof HTMLAnchorElement ? current : null;
}

export function executeScripts(container: HTMLElement): void {
  const targetDocument = container.ownerDocument ?? document;
  const activeNonce = targetDocument ? getManagedHeadNonce(targetDocument) : undefined;
  for (const oldScript of container.querySelectorAll("script")) {
    // Head-directive scripts are activated when their clone is appended to the
    // document head. Activating them here as body scripts as well would execute
    // the same server-provided code twice.
    if (isInsideHeadDirective(oldScript, container)) continue;

    const newScript = targetDocument.createElement("script");

    for (const { name, value } of oldScript.attributes) {
      if (name.toLowerCase() !== "nonce") newScript.setAttribute(name, value);
    }
    if (activeNonce) newScript.setAttribute("nonce", activeNonce);

    newScript.textContent = oldScript.textContent;
    oldScript.parentNode?.replaceChild(newScript, oldScript);
  }
}

function isInsideHeadDirective(node: Element, boundary: Element): boolean {
  let current = node.parentElement;
  while (current && current !== boundary) {
    if (
      current.tagName.toLowerCase() === "vf-head" ||
      current.getAttribute("data-veryfront-head") === "1"
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function applyHeadDirectives(container: HTMLElement): void {
  const targetDocument = container.ownerDocument ?? document;
  const nodes = [...container.querySelectorAll('[data-veryfront-head="1"], vf-head')]
    .filter((node) =>
      typeof node.getAttribute !== "function" ||
      node.getAttribute(HEAD_REACT_OWNER_ATTRIBUTE) !== "1"
    );
  if (!nodes.length) return;

  retireClientHeadOwnership(targetDocument);
  cleanManagedHeadTags(targetDocument);

  for (const wrapper of nodes) {
    const TemplateElement = targetDocument.defaultView?.HTMLTemplateElement ??
      globalThis.HTMLTemplateElement;
    const contentSource = TemplateElement && wrapper instanceof TemplateElement
      ? wrapper.content
      : wrapper;

    processHeadWrapper(contentSource, targetDocument);
    wrapper.parentElement?.removeChild(wrapper);
  }
}

function cleanManagedHeadTags(targetDocument: Document): void {
  for (
    const element of targetDocument.head.querySelectorAll(
      `[${HEAD_LEGACY_MANAGED_ATTRIBUTE}="1"]`,
    )
  ) {
    element.parentElement?.removeChild(element);
  }
}

function processHeadWrapper(
  wrapper: Element | DocumentFragment,
  targetDocument: Document,
): void {
  const ElementConstructor = targetDocument.defaultView?.Element ??
    globalThis.Element;
  const activeNonce = getManagedHeadNonce(targetDocument);
  for (const node of wrapper.childNodes) {
    if (!ElementConstructor || !(node instanceof ElementConstructor)) continue;

    const tagName = node.tagName.toLowerCase();
    if (headSingletonKey(node) === "meta:charset") continue;

    const clone = targetDocument.createElement(tagName);

    for (const { name, value } of node.attributes) {
      if (name.toLowerCase() !== "nonce") clone.setAttribute(name, value);
    }
    if (
      activeNonce &&
      (tagName === "script" || tagName === "style" || tagName === "link")
    ) {
      clone.setAttribute("nonce", activeNonce);
    }

    if (node.textContent && !clone.hasAttribute("src")) {
      clone.textContent = node.textContent;
    }

    replaceExistingHeadSingleton(targetDocument, clone);
    clone.setAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE, "1");
    clone.setAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE, "true");
    targetDocument.head.appendChild(clone);
  }
}

function headSingletonKey(element: Element): string | undefined {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "title") return "title";
  if (tagName !== "meta" && tagName !== "link") return undefined;

  const attributes = Object.create(null) as Record<string, string>;
  if (!element.attributes) return undefined;
  for (const { name, value } of element.attributes) attributes[name.toLowerCase()] = value;
  if (
    tagName === "meta" &&
    attributes["http-equiv"]?.trim().toLowerCase() === "content-type"
  ) {
    return "meta:charset";
  }
  return tagName === "meta"
    ? headMetaSingletonKeyFromRecord(attributes)
    : headLinkSingletonKeyFromRecord(attributes);
}

function replaceExistingHeadSingleton(
  targetDocument: Document,
  replacement: Element,
): void {
  const singletonKey = headSingletonKey(replacement);
  if (!singletonKey || singletonKey === "meta:charset") return;

  for (const existing of [...(targetDocument.head?.children ?? [])]) {
    if (headSingletonKey(existing) === singletonKey) existing.remove();
  }
}

export function manageFocus(container: HTMLElement): void {
  try {
    const focusElement = container.querySelector<HTMLElement>("[data-router-focus]") ||
      container.querySelector<HTMLElement>("main") ||
      container.querySelector<HTMLElement>("h1");

    focusElement?.focus?.({ preventScroll: true });
  } catch (error) {
    logger.warn("focus management failed", error);
  }
}

export function extractPageDataFromScript(): PageData | null {
  const pageDataScript = document.querySelector("script[data-veryfront-page]");
  if (!pageDataScript) return null;

  try {
    const content = pageDataScript.textContent;

    if (!content) {
      logger.warn("Page data script has no content");
      return {};
    }

    return JSON.parse(content) as PageData;
  } catch (error) {
    logger.error("Failed to parse page data:", error);
    return null;
  }
}

function descriptorFromDocumentHeadElement(element: Element): ManagedHeadDescriptor | null {
  const tagName = element.tagName.toLowerCase();
  const record = Object.create(null) as Record<string, unknown>;
  for (const { name, value } of element.attributes) {
    if (!isHeadFrameworkAttribute(name) && name.toLowerCase() !== "nonce") {
      record[name.toLowerCase()] = value;
    }
  }
  const supportsText = tagName === "title" || tagName === "script" || tagName === "style";
  if (supportsText) record[PARSED_ROUTE_HEAD_CONTENT_PROPERTY] = element.textContent ?? "";
  return descriptorFromManagedHeadRecord(tagName, record, {
    ...(supportsText && { contentProperty: PARSED_ROUTE_HEAD_CONTENT_PROPERTY }),
  });
}

function payloadDescriptors(root: ParentNode | null): ManagedHeadDescriptor[] {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  const descriptors: ManagedHeadDescriptor[] = [];
  for (const element of root.querySelectorAll(`[${HEAD_SSR_PAYLOAD_ATTRIBUTE}]`)) {
    if (element.getAttribute(HEAD_REACT_OWNER_ATTRIBUTE) !== "1") continue;
    const payload = element.getAttribute(HEAD_SSR_PAYLOAD_ATTRIBUTE);
    if (payload) descriptors.push(...deserializeManagedHeadPayload(payload));
  }
  return descriptors;
}

export function snapshotClientRouteHead(
  targetDocument: Document = document,
): ClientRouteHeadEntry[] {
  const descriptors: ManagedHeadDescriptor[] = [];
  let hasStructuredPayload = false;
  const hydrationDataScript = targetDocument.getElementById("veryfront-hydration-data");
  if (hydrationDataScript?.textContent) {
    try {
      const hydrationData = JSON.parse(hydrationDataScript.textContent) as {
        managedHeadPayload?: unknown;
      };
      if (typeof hydrationData.managedHeadPayload === "string") {
        descriptors.push(...deserializeManagedHeadPayload(hydrationData.managedHeadPayload));
        hasStructuredPayload = true;
      }
    } catch {
      // A partial or corrupt hydration payload cannot own head state. The
      // provenance fallback below remains safe to snapshot.
    }
  }

  const committedDescriptors = payloadDescriptors(targetDocument.getElementById("root"));
  descriptors.push(...committedDescriptors);
  const fallbackSelector = [
    ...(committedDescriptors.length === 0 ? [`[${HEAD_PROVENANCE_ATTRIBUTE}="true"]`] : []),
    ...(!hasStructuredPayload ? [`[${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true"]`] : []),
  ].join(", ");
  if (fallbackSelector && targetDocument.head?.querySelectorAll) {
    for (const element of targetDocument.head.querySelectorAll(fallbackSelector)) {
      const descriptor = descriptorFromDocumentHeadElement(element);
      if (descriptor) descriptors.push(descriptor);
    }
  }

  const aggregated = aggregateManagedHeadDescriptors(descriptors);
  assertManagedHeadDescriptorBudget(aggregated);
  return aggregated.map(managedHeadDescriptorToTransportEntry);
}

export function parsePageDataFromHTML(html: string): {
  content: string | undefined;
  pageData: PageData;
  managedHead: ClientRouteHeadEntry[];
  dependencyPinningCacheKey?: string;
} {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const root = doc.getElementById("root");
  if (!root) logger.warn("[Veryfront] No root element found in HTML");

  // A response without an app root (proxy interstitial, custom error page)
  // carries no route content. It stays `undefined` so consumers skip the
  // transition; `""` is reserved for a route that is deliberately empty.
  const content = root ? root.innerHTML ?? "" : undefined;

  const pageDataScript = doc.querySelector("script[data-veryfront-page]");
  let pageData: PageData = {};

  if (pageDataScript) {
    try {
      const scriptContent = pageDataScript.textContent;

      if (!scriptContent) {
        logger.warn("Page data script in HTML has no content");
      } else {
        pageData = JSON.parse(scriptContent) as PageData;
      }
    } catch (error) {
      logger.error("Failed to parse page data from HTML:", error);
    }
  }

  let dependencyPinningCacheKey: string | undefined;
  const hydrationDataScript = doc.getElementById("veryfront-hydration-data");
  if (hydrationDataScript?.textContent) {
    try {
      const hydrationData = JSON.parse(hydrationDataScript.textContent) as {
        dependencyPinningCacheKey?: unknown;
      };
      if (typeof hydrationData.dependencyPinningCacheKey === "string") {
        dependencyPinningCacheKey = hydrationData.dependencyPinningCacheKey;
      }
    } catch (error) {
      logger.error("Failed to parse hydration data from HTML:", error);
    }
  }

  const managedHead = snapshotClientRouteHead(doc);
  if (
    managedHead.some((entry) => entry.tagName === "script") ||
    (typeof root?.querySelector === "function" && root.querySelector("script"))
  ) {
    pageData = { ...pageData, requiresFullDocumentNavigation: true };
  }

  return { content, pageData, managedHead, dependencyPinningCacheKey };
}
