import { rendererLogger as logger } from "@veryfront/utils";
import type { FrontmatterData, PageData } from "./types.ts";

export function isInternalLink(target: HTMLAnchorElement): boolean {
  const href = target.getAttribute("href");

  if (!href) return false;
  if (href.startsWith("http") || href.startsWith("mailto:")) return false;
  if (href.startsWith("#")) return false;
  if (target.getAttribute("target") === "_blank" || target.getAttribute("download")) {
    return false;
  }

  return true;
}

export function findAnchorElement(element: HTMLElement | null): HTMLAnchorElement | null {
  let current = element;
  while (current && current.tagName !== "A") {
    current = current.parentElement;
  }

  if (!current || !(current instanceof HTMLAnchorElement)) {
    return null;
  }

  return current;
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
  container.querySelectorAll("script").forEach((oldScript) => {
    const newScript = document.createElement("script");
    for (const { name, value } of oldScript.attributes) {
      newScript.setAttribute(name, value);
    }
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode?.replaceChild(newScript, oldScript);
  });
}

export function applyHeadDirectives(container: HTMLElement): void {
  const nodes = container.querySelectorAll('[data-veryfront-head="1"], vf-head');
  if (nodes.length > 0) {
    cleanManagedHeadTags();
  }

  nodes.forEach((wrapper) => {
    const isTemplate = typeof HTMLTemplateElement !== "undefined" &&
      wrapper instanceof HTMLTemplateElement;
    const contentSource = isTemplate ? (wrapper as HTMLTemplateElement).content : wrapper;
    processHeadWrapper(contentSource);
    wrapper.parentElement?.removeChild(wrapper);
  });
}

function cleanManagedHeadTags(): void {
  document.head
    .querySelectorAll('[data-veryfront-managed="1"]')
    .forEach((element) => element.parentElement?.removeChild(element));
}

function processHeadWrapper(wrapper: Element | DocumentFragment): void {
  wrapper.childNodes.forEach((node) => {
    if (!(node instanceof Element)) return;

    const tagName = node.tagName.toLowerCase();
    if (tagName === "title") {
      document.title = node.textContent || document.title;
      return;
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
  });
}

export function manageFocus(container: HTMLElement): void {
  try {
    const focusElement = (container.querySelector("[data-router-focus]") ||
      container.querySelector("main") ||
      container.querySelector("h1")) as HTMLElement | null;

    if (focusElement && focusElement instanceof HTMLElement && "focus" in focusElement) {
      focusElement.focus({ preventScroll: true });
    }
  } catch (error) {
    logger.warn("[Veryfront] focus management failed", error);
  }
}

export function extractPageDataFromScript(): PageData | null {
  const pageDataScript = document.querySelector("script[data-veryfront-page]");
  if (!pageDataScript) return null;

  try {
    const content = pageDataScript.textContent;
    if (!content) {
      logger.warn("[Veryfront] Page data script has no content");
      return {};
    }
    return JSON.parse(content) as PageData;
  } catch (error) {
    logger.error("[Veryfront] Failed to parse page data:", error);
    return null;
  }
}

export function parsePageDataFromHTML(html: string): {
  content: string;
  pageData: PageData;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const root = doc.getElementById("root");
  let content = "";

  if (root) {
    content = root.innerHTML || "";
  } else {
    logger.warn("[Veryfront] No root element found in HTML");
  }

  const pageDataScript = doc.querySelector("script[data-veryfront-page]");
  let pageData: PageData = {};

  if (pageDataScript) {
    try {
      const content = pageDataScript.textContent;
      if (!content) {
        logger.warn("[Veryfront] Page data script in HTML has no content");
      } else {
        pageData = JSON.parse(content) as PageData;
      }
    } catch (error) {
      logger.error("[Veryfront] Failed to parse page data from HTML:", error);
    }
  }

  return { content, pageData };
}
