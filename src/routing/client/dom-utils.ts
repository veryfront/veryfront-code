import { rendererLogger } from "#veryfront/utils";
import type { FrontmatterData, PageData } from "./types.ts";
import {
  HEAD_LEGACY_MANAGED_ATTRIBUTE,
  HEAD_REACT_OWNER_ATTRIBUTE,
} from "#veryfront/html/managed-head-protocol.ts";
import { retireClientHeadOwnership } from "#veryfront/html/client-head-manager.ts";

const logger = rendererLogger.component("veryfront");
const EXPLICIT_URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function isInternalLink(target: HTMLAnchorElement): boolean {
  const rawHref = target.getAttribute("href");
  if (!rawHref) return false;
  const href = rawHref.trim();
  if (!href) return false;

  if (
    href.startsWith("#") ||
    EXPLICIT_URL_SCHEME.test(href) ||
    /^[\\/]{2}/.test(href) ||
    /^[/\\][\\/]/.test(href)
  ) {
    return false;
  }

  const linkTarget = target.getAttribute("target")?.trim().toLowerCase();
  if (
    (linkTarget && linkTarget !== "_self") ||
    target.getAttribute("download") !== null
  ) {
    return false;
  }

  return true;
}

export function findAnchorElement(element: HTMLElement | null): HTMLAnchorElement | null {
  let current: HTMLElement | null = element;

  while (current && current.tagName !== "A") {
    current = current.parentElement;
  }

  return current instanceof HTMLAnchorElement ? current : null;
}

export function updateMetaTags(frontmatter: FrontmatterData): void {
  updateMetaTag(
    'meta[name="description"]',
    "name",
    "description",
    frontmatter.description,
  );
  updateMetaTag(
    'meta[property="og:title"]',
    "property",
    "og:title",
    frontmatter.ogTitle,
  );
}

function updateMetaTag(
  selector: string,
  attributeName: string,
  attributeValue: string,
  content: string | undefined,
): void {
  let metaTag = document.querySelector(selector);

  if (!content) {
    metaTag?.remove();
    return;
  }

  if (!metaTag) {
    metaTag = document.createElement("meta");
    metaTag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(metaTag);
  }

  metaTag.setAttribute("content", content);
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

    if (tagName === "title") {
      targetDocument.title = node.textContent ?? "";
      continue;
    }

    const clone = targetDocument.createElement(tagName);

    for (const { name, value } of node.attributes) {
      clone.setAttribute(name, value);
    }

    if (node.textContent && !clone.hasAttribute("src")) {
      clone.textContent = node.textContent;
    }

    clone.setAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE, "1");
    targetDocument.head.appendChild(clone);
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

export function parsePageDataFromHTML(html: string): { content: string; pageData: PageData } {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const root = doc.getElementById("root");
  if (!root) logger.warn("[Veryfront] No root element found in HTML");

  const content = root?.innerHTML ?? "";

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

  return { content, pageData };
}

/**
 * Parse a navigation document without the legacy empty-page fallbacks.
 *
 * PageLoader uses this boundary after a successful HTTP response so malformed
 * server output cannot replace the current page with a silent blank document.
 */
export function parsePageDataFromHTMLStrict(
  html: string,
): { content: string; pageData: PageData } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.getElementById("root");
  if (!root) throw new TypeError("Navigation HTML must contain a #root element");

  const pageDataScript = doc.querySelector("script[data-veryfront-page]");
  if (!pageDataScript) return { content: root.innerHTML, pageData: {} };
  const scriptContent = pageDataScript.textContent;
  if (!scriptContent) {
    throw new TypeError("Navigation page-data script must contain JSON");
  }

  let pageData: unknown;
  try {
    pageData = JSON.parse(scriptContent);
  } catch (cause) {
    throw new TypeError("Navigation page-data script contains malformed JSON", {
      cause,
    });
  }
  if (typeof pageData !== "object" || pageData === null || Array.isArray(pageData)) {
    throw new TypeError("Navigation page-data script must contain a JSON object");
  }
  return { content: root.innerHTML, pageData: pageData as PageData };
}
