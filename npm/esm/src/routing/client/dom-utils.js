import { rendererLogger as logger } from "../../utils/index.js";
export function isInternalLink(target) {
    const href = target.getAttribute("href");
    if (!href)
        return false;
    if (href.startsWith("http") || href.startsWith("mailto:"))
        return false;
    if (href.startsWith("#"))
        return false;
    if (target.getAttribute("target") === "_blank" || target.getAttribute("download"))
        return false;
    return true;
}
export function findAnchorElement(element) {
    let current = element;
    while (current && current.tagName !== "A") {
        current = current.parentElement;
    }
    return current instanceof HTMLAnchorElement ? current : null;
}
export function updateMetaTags(frontmatter) {
    if (frontmatter.description) {
        updateMetaTag('meta[name="description"]', "name", "description", frontmatter.description);
    }
    if (frontmatter.ogTitle) {
        updateMetaTag('meta[property="og:title"]', "property", "og:title", frontmatter.ogTitle);
    }
}
function updateMetaTag(selector, attributeName, attributeValue, content) {
    let metaTag = document.querySelector(selector);
    if (!metaTag) {
        metaTag = document.createElement("meta");
        metaTag.setAttribute(attributeName, attributeValue);
        document.head.appendChild(metaTag);
    }
    metaTag.setAttribute("content", content);
}
export function executeScripts(container) {
    for (const oldScript of container.querySelectorAll("script")) {
        const newScript = document.createElement("script");
        for (const { name, value } of oldScript.attributes) {
            newScript.setAttribute(name, value);
        }
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode?.replaceChild(newScript, oldScript);
    }
}
export function applyHeadDirectives(container) {
    const nodes = container.querySelectorAll('[data-veryfront-head="1"], vf-head');
    if (!nodes.length)
        return;
    cleanManagedHeadTags();
    for (const wrapper of nodes) {
        const contentSource = typeof HTMLTemplateElement !== "undefined" && wrapper instanceof HTMLTemplateElement
            ? wrapper.content
            : wrapper;
        processHeadWrapper(contentSource);
        wrapper.parentElement?.removeChild(wrapper);
    }
}
function cleanManagedHeadTags() {
    for (const element of document.head.querySelectorAll('[data-veryfront-managed="1"]')) {
        element.parentElement?.removeChild(element);
    }
}
function processHeadWrapper(wrapper) {
    for (const node of wrapper.childNodes) {
        if (!(node instanceof Element))
            continue;
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
export function manageFocus(container) {
    try {
        const focusElement = container.querySelector("[data-router-focus]") ||
            container.querySelector("main") ||
            container.querySelector("h1");
        focusElement?.focus?.({ preventScroll: true });
    }
    catch (error) {
        logger.warn("[Veryfront] focus management failed", error);
    }
}
export function extractPageDataFromScript() {
    const pageDataScript = document.querySelector("script[data-veryfront-page]");
    if (!pageDataScript)
        return null;
    try {
        const content = pageDataScript.textContent;
        if (!content) {
            logger.warn("[Veryfront] Page data script has no content");
            return {};
        }
        return JSON.parse(content);
    }
    catch (error) {
        logger.error("[Veryfront] Failed to parse page data:", error);
        return null;
    }
}
export function parsePageDataFromHTML(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.getElementById("root");
    const content = root?.innerHTML || "";
    if (!root) {
        logger.warn("[Veryfront] No root element found in HTML");
    }
    const pageDataScript = doc.querySelector("script[data-veryfront-page]");
    let pageData = {};
    if (pageDataScript) {
        try {
            const scriptContent = pageDataScript.textContent;
            if (!scriptContent) {
                logger.warn("[Veryfront] Page data script in HTML has no content");
            }
            else {
                pageData = JSON.parse(scriptContent);
            }
        }
        catch (error) {
            logger.error("[Veryfront] Failed to parse page data from HTML:", error);
        }
    }
    return { content, pageData };
}
