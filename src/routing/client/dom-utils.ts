import { rendererLogger } from "#veryfront/utils";
import type { ClientRouteHeadEntry, PageData } from "./types.ts";
export {
  updateRouteMetaTags as updateMetaTags,
  updateRouteTitle,
} from "#veryfront/html/client-route-head.ts";
import {
  descriptorFromManagedHeadRecord,
  HEAD_LEGACY_MANAGED_ATTRIBUTE,
  HEAD_PROVENANCE_ATTRIBUTE,
  HEAD_REACT_OWNER_ATTRIBUTE,
  HEAD_ROUTE_MANAGED_ATTRIBUTE,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  headLinkSingletonKeyFromRecord,
  headMetaSingletonKeyFromRecord,
  isHeadFrameworkAttribute,
} from "#veryfront/html/managed-head-protocol.ts";
import { retireClientHeadOwnership } from "#veryfront/html/client-head-manager.ts";

const logger = rendererLogger.component("veryfront");
const MAX_PARSED_ROUTE_HEAD_ENTRIES = 100;
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
  for (const oldScript of container.querySelectorAll("script")) {
    // Head-directive scripts are activated when their clone is appended to the
    // document head. Activating them here as body scripts as well would execute
    // the same server-provided code twice.
    if (isInsideHeadDirective(oldScript, container)) continue;

    const newScript = targetDocument.createElement("script");

    for (const { name, value } of oldScript.attributes) {
      newScript.setAttribute(name, value);
    }

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
  for (const node of wrapper.childNodes) {
    if (!ElementConstructor || !(node instanceof ElementConstructor)) continue;

    const tagName = node.tagName.toLowerCase();

    const clone = targetDocument.createElement(tagName);

    for (const { name, value } of node.attributes) {
      clone.setAttribute(name, value);
    }

    if (node.textContent && !clone.hasAttribute("src")) {
      clone.textContent = node.textContent;
    }

    if (headSingletonKey(clone) === "meta:charset") continue;
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

export function parsePageDataFromHTML(html: string): {
  content: string;
  pageData: PageData;
  managedHead: ClientRouteHeadEntry[];
  dependencyPinningCacheKey?: string;
} {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const root = doc.getElementById("root");
  if (!root) logger.warn("[Veryfront] No root element found in HTML");

  const content = root?.innerHTML ?? "";

  const managedElements = [
    ...doc.querySelectorAll(
      `[${HEAD_PROVENANCE_ATTRIBUTE}="true"], [${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true"]`,
    ),
  ];
  if (managedElements.length > MAX_PARSED_ROUTE_HEAD_ENTRIES) {
    throw new TypeError("Fetched document exceeds the managed-head entry limit");
  }
  const managedHead = managedElements.flatMap((element): ClientRouteHeadEntry[] => {
    const tagName = element.tagName.toLowerCase();
    const record = Object.create(null) as Record<string, unknown>;
    for (const { name, value } of element.attributes) {
      if (!isHeadFrameworkAttribute(name)) record[name] = value;
    }
    const supportsText = tagName === "title" || tagName === "script" || tagName === "style";
    if (supportsText) {
      record[PARSED_ROUTE_HEAD_CONTENT_PROPERTY] = element.textContent ?? "";
    }
    const descriptor = descriptorFromManagedHeadRecord(
      tagName,
      record,
      supportsText ? { contentProperty: PARSED_ROUTE_HEAD_CONTENT_PROPERTY } : undefined,
    );
    if (!descriptor) return [];
    return [{
      tagName: descriptor.tagName,
      attributes: descriptor.attributes.map(([name, value]) => [name, value]),
      ...(descriptor.content !== undefined && { content: descriptor.content }),
    }];
  });

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

  return { content, pageData, managedHead, dependencyPinningCacheKey };
}
