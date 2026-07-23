import { rendererLogger } from "#veryfront/utils";
import type { FrontmatterData, PageData } from "./types.ts";

const logger = rendererLogger.component("veryfront");

export function isInternalLink(target: HTMLAnchorElement): boolean {
  const href = target.getAttribute("href")?.trim();
  if (!href) return false;

  const baseUrl = getNavigationBaseUrl();
  const url = resolveInternalNavigationUrl(href, baseUrl);
  if (!url) return false;
  if (
    url.hash && url.pathname === baseUrl.pathname && url.search === baseUrl.search &&
    (href.startsWith("#") || url.href === baseUrl.href.replace(/#.*$/, "") + url.hash)
  ) return false;

  const linkTarget = target.getAttribute("target")?.trim().toLowerCase();
  if (linkTarget && linkTarget !== "_self") return false;
  if (target.getAttribute("download") !== null) return false;

  return true;
}

/** Resolve a navigation target only when it stays on the current HTTP(S) origin. */
export function resolveInternalNavigationUrl(
  value: string,
  baseUrl = getNavigationBaseUrl(),
): URL | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== baseUrl.origin) return null;
    if (url.username || url.password) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function getNavigationBaseUrl(): URL {
  const location = globalThis.location;
  const documentBase = typeof globalThis.document?.baseURI === "string"
    ? globalThis.document.baseURI
    : undefined;
  const locationHref = typeof location?.href === "string" ? location.href : undefined;
  const browserBase = locationHref ?? documentBase;

  if (browserBase) {
    try {
      return new URL(browserBase);
    } catch (_) {
      // Fall through to the non-browser test/runtime base.
    }
  }

  const pathname = typeof location?.pathname === "string" ? location.pathname : "/";
  const search = typeof location?.search === "string" ? location.search : "";
  const hash = typeof location?.hash === "string" ? location.hash : "";
  return new URL(`${pathname}${search}${hash}`, "http://veryfront.local");
}

export function findAnchorElement(element: HTMLElement | null): HTMLAnchorElement | null {
  let current: HTMLElement | null = element;

  while (current && current.tagName !== "A") {
    current = current.parentElement;
  }

  return current instanceof HTMLAnchorElement ? current : null;
}

export function updateMetaTags(frontmatter: FrontmatterData): void {
  if (frontmatter.description) {
    updateMetaTag('meta[name="description"]', "name", "description", frontmatter.description);
  }

  if (frontmatter.ogTitle) {
    updateMetaTag('meta[property="og:title"]', "property", "og:title", frontmatter.ogTitle);
  }
}

function updateMetaTag(
  selector: string,
  attributeName: string,
  attributeValue: string,
  content: string,
): void {
  let metaTag = document.querySelector(selector);

  if (!metaTag) {
    metaTag = document.createElement("meta");
    metaTag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(metaTag);
  }

  metaTag.setAttribute("content", content);
}

export function executeScripts(container: HTMLElement): void {
  for (const oldScript of container.querySelectorAll("script")) {
    const newScript = document.createElement("script");

    for (const { name, value } of oldScript.attributes) {
      newScript.setAttribute(name, value);
    }

    newScript.textContent = oldScript.textContent;
    oldScript.parentNode?.replaceChild(newScript, oldScript);
  }
}

export function applyHeadDirectives(container: HTMLElement): void {
  const nodes = container.querySelectorAll('[data-veryfront-head="1"], vf-head');
  if (!nodes.length) return;

  cleanManagedHeadTags();

  for (const wrapper of nodes) {
    const contentSource =
      typeof HTMLTemplateElement !== "undefined" && wrapper instanceof HTMLTemplateElement
        ? wrapper.content
        : wrapper;

    processHeadWrapper(contentSource);
    wrapper.parentElement?.removeChild(wrapper);
  }
}

function cleanManagedHeadTags(): void {
  for (const element of document.head.querySelectorAll('[data-veryfront-managed="1"]')) {
    element.parentElement?.removeChild(element);
  }
}

function processHeadWrapper(wrapper: Element | DocumentFragment): void {
  for (const node of wrapper.childNodes) {
    if (!(node instanceof Element)) continue;

    const tagName = node.tagName.toLowerCase();

    if (tagName === "title") {
      document.title = node.textContent || document.title;
      continue;
    }

    const clone = document.createElement(tagName);

    for (const { name, value } of node.attributes) {
      clone.setAttribute(name, value);
    }

    if (node.textContent && !clone.hasAttribute("src")) {
      clone.textContent = node.textContent;
    }

    clone.setAttribute("data-veryfront-managed", "1");
    document.head.appendChild(clone);
  }
}

export function manageFocus(container: HTMLElement): void {
  try {
    const focusElement = container.querySelector<HTMLElement>("[data-router-focus]") ||
      container.querySelector<HTMLElement>("main") ||
      container.querySelector<HTMLElement>("h1");

    focusElement?.focus?.({ preventScroll: true });
  } catch (error) {
    logger.warn("focus management failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
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
    logger.error("Failed to parse page data", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
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
      logger.error("Failed to parse page data from HTML", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  return { content, pageData };
}
