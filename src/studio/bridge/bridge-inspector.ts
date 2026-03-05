/**
 * Bridge Inspector
 *
 * Overlays, DOM tree building, inspect mode, and mutation observer.
 */

import { DOM_IGNORE_TAGS, state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import {
  DATA_NODE_COLUMN,
  DATA_NODE_FILE,
  DATA_NODE_ID,
  DATA_NODE_LINE,
  DATA_NODE_NAME,
  DATA_VF_ID,
  DATA_VF_IGNORE,
  DATA_VF_SELECTOR,
  DATA_VF_TEXT,
} from "./bridge-constants.ts";
import { postToStudio } from "./bridge-messaging.ts";
import { debounce } from "./bridge-utils.ts";

// --- Overlay helpers ---

export function createOverlay(type: string): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "vf-overlay vf-overlay-" + type;
  overlay.setAttribute(DATA_VF_IGNORE, "true");

  const label = document.createElement("div");
  label.className = "vf-overlay-label";
  overlay.appendChild(label);

  overlay.style.display = "none";
  document.body.appendChild(overlay);
  return overlay;
}

export function hideOverlay(overlay: HTMLElement | null): void {
  if (overlay) overlay.style.display = "none";
}

export function positionOverlay(
  overlay: HTMLElement | null,
  element: Element,
  nodeName: string,
): void {
  if (!overlay) return;
  if (!element) {
    hideOverlay(overlay);
    return;
  }

  const rect = element.getBoundingClientRect();
  overlay.style.display = "block";
  overlay.style.top = rect.top + "px";
  overlay.style.left = rect.left + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";

  const label = overlay.querySelector(".vf-overlay-label") as HTMLElement;
  if (label) {
    label.textContent = nodeName;
    if (rect.top < 24) {
      label.classList.add("vf-overlay-label-bottom");
    } else {
      label.classList.remove("vf-overlay-label-bottom");
    }
  }
}

export function getNodeName(element: Element): string {
  const vfId = element.getAttribute(DATA_VF_ID);
  if (vfId) return vfId.split("_")[0]!;
  return element.tagName.toLowerCase();
}

export function findElementById(nodeId: string | null): Element | null {
  if (!nodeId) return null;
  return (
    document.querySelector("[" + DATA_VF_ID + '="' + nodeId + '"]') ||
    document.querySelector("[" + DATA_VF_SELECTOR + '="' + nodeId + '"]') ||
    document.querySelector("[" + DATA_NODE_ID + '="' + nodeId + '"]')
  );
}

// --- Tree building ---

function isValidElement(el: Element): boolean {
  return (
    !!el &&
    el.nodeType === Node.ELEMENT_NODE &&
    !DOM_IGNORE_TAGS.includes(el.tagName) &&
    !el.hasAttribute(DATA_VF_IGNORE) &&
    (el as HTMLElement).style.display !== "none"
  );
}

function getNodeType(el: Element): string {
  const tagName = el.tagName.toLowerCase();

  const vfId = el.getAttribute(DATA_VF_ID) || "";
  if (vfId && /^[A-Z]/.test(vfId)) return "component";
  if (el.hasAttribute(DATA_VF_TEXT)) return "text";

  if (
    ["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "ul", "ol", "li", "pre", "code"]
      .includes(tagName)
  ) {
    return "markdown";
  }

  return "element";
}

export function buildNavigatorTree(root: Element): any {
  const config = getConfig();
  let nodeIndex = 0;

  function processElement(el: Element, parentId: string): any[] {
    if (!isValidElement(el)) {
      const children: any[] = [];
      Array.from(el.children || []).forEach((child) => {
        children.push(...processElement(child, parentId));
      });
      return children;
    }

    let id = el.getAttribute(DATA_VF_ID) ||
      el.getAttribute(DATA_NODE_ID) ||
      el.getAttribute(DATA_VF_SELECTOR);
    if (!id) {
      id = "vf-" + el.tagName.toLowerCase() + "-" + ++nodeIndex;
      el.setAttribute(DATA_VF_SELECTOR, id);
    }

    const vfId = el.getAttribute(DATA_VF_ID);
    const name = vfId ? vfId.split("_")[0] : el.tagName.toLowerCase();

    const node: any = {
      id: id,
      name: name,
      type: getNodeType(el),
      path: config.pagePath,
      parentId: parentId,
      start: {
        line: parseInt(el.getAttribute(DATA_NODE_LINE) || "0", 10),
        column: parseInt(el.getAttribute(DATA_NODE_COLUMN) || "0", 10),
      },
      end: { line: 0, column: 0 },
      children: [],
      text: el.hasAttribute(DATA_VF_TEXT) ? el.textContent?.trim() : undefined,
      isRemote: false,
    };

    Array.from(el.children || []).forEach((child) => {
      node.children.push(...processElement(child, id!));
    });

    return [node];
  }

  const rootNode: any = {
    id: "root",
    name: "root",
    type: "root",
    path: "",
    parentId: "",
    start: { line: 0, column: 0 },
    end: { line: 0, column: 0 },
    children: [],
  };

  Array.from(root.children || []).forEach((child) => {
    rootNode.children.push(...processElement(child, "root"));
  });

  return rootNode;
}

function createTreeSignature(root: Element): string {
  const validElements = Array.from(root.querySelectorAll("*")).filter((el) => isValidElement(el));
  return validElements.length + "-" + validElements.map((el) => el.tagName).join("");
}

let treeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let mutationObserver: MutationObserver | null = null;

export function sendTreeUpdate(): void {
  const config = getConfig();
  const root = document.getElementById("root") || document.body;
  if (!root) return;

  const signature = createTreeSignature(root);
  if (signature === state.lastTreeSignature) return;
  state.lastTreeSignature = signature;

  postToStudio({
    action: "treeUpdated",
    id: config.pageId,
    url: window.location.href,
    tree: buildNavigatorTree(root),
    sourceHash: (window as any).__VERYFRONT_SOURCE_HASH__ || null,
  });
}

function debouncedTreeUpdate(): void {
  if (treeUpdateTimer) clearTimeout(treeUpdateTimer);
  treeUpdateTimer = setTimeout(sendTreeUpdate, 150);
}

export function setupMutationObserver(): void {
  const root = document.getElementById("root") || document.body;
  if (!root) return;

  mutationObserver = new MutationObserver(function (mutations) {
    const hasRelevantChanges = mutations.some(
      (m) => m.type === "childList" || m.type === "characterData",
    );
    if (hasRelevantChanges) debouncedTreeUpdate();
  });

  mutationObserver.observe(root, { childList: true, characterData: true, subtree: true });
  sendTreeUpdate();
}

// --- Show/hide overlays for specific nodes ---

export function showOverlay(overlay: HTMLElement | null, nodeId: string | null): void {
  if (!nodeId) {
    hideOverlay(overlay);
    return;
  }

  const el = findElementById(nodeId);
  if (!el) {
    hideOverlay(overlay);
    return;
  }

  positionOverlay(overlay, el, getNodeName(el));
}

export function showHoverOverlay(nodeId: string | null): void {
  showOverlay(state.hoverOverlay, nodeId);
}

export function showSelectionOverlay(nodeId: string | null): void {
  showOverlay(state.selectionOverlay, nodeId);
}

export function scrollToElement(nodeId: string): void {
  const el = document.querySelector("[" + DATA_VF_ID + '="' + nodeId + '"]') ||
    document.querySelector("[" + DATA_NODE_ID + '="' + nodeId + '"]') ||
    document.querySelector("[" + DATA_VF_SELECTOR + '*="' + nodeId + '"]');

  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// --- Inspect mode ---

function getDirectText(el: Element): string {
  let text = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
      text += el.childNodes[i].textContent || "";
    }
  }
  return text.trim();
}

export function setupInspectMode(): void {
  const INSPECTABLE_SELECTOR = "[" + DATA_VF_ID + "], [" + DATA_VF_SELECTOR + "], [" +
    DATA_NODE_ID + "], [" + DATA_NODE_FILE + "]";

  function getElementId(el: Element): string | null {
    return (
      el.getAttribute(DATA_VF_ID) ||
      el.getAttribute(DATA_NODE_ID) ||
      el.getAttribute(DATA_VF_SELECTOR)
    );
  }

  document.addEventListener(
    "click",
    function (event) {
      if (!state.inspectMode) return;

      event.preventDefault();
      event.stopPropagation();

      const target = (event.target as Element).closest(INSPECTABLE_SELECTOR);
      if (!target) {
        state.selectedNodeId = null;
        hideOverlay(state.selectionOverlay);
        postToStudio({ action: "setSelectedNode", id: null });
        return;
      }

      const id = getElementId(target);
      state.selectedNodeId = id;
      showSelectionOverlay(id);
      postToStudio({
        action: "setSelectedNode",
        id: id,
        node: {
          name: target.getAttribute(DATA_NODE_NAME) || target.tagName.toLowerCase(),
          type: getNodeType(target),
          file: target.getAttribute(DATA_NODE_FILE) || getConfig().pagePath,
          line: parseInt(target.getAttribute(DATA_NODE_LINE) || "0", 10),
          column: parseInt(target.getAttribute(DATA_NODE_COLUMN) || "0", 10),
          text: getDirectText(target).slice(0, 200),
        },
      });
    },
    true,
  );

  document.addEventListener("pointerover", function (event) {
    if (!state.inspectMode || (event as PointerEvent).pointerType === "touch") return;

    const target = (event.target as Element).closest(INSPECTABLE_SELECTOR);
    if (!target) return;

    const id = getElementId(target);
    if (id === state.hoveredNodeId) return;

    state.hoveredNodeId = id;
    showHoverOverlay(id);
  });

  document.addEventListener("pointerout", function (event) {
    if (!state.inspectMode || (event as PointerEvent).pointerType === "touch") return;

    const target = (event.target as Element).closest(INSPECTABLE_SELECTOR);
    if (!target) return;

    const relatedTarget = (event as PointerEvent).relatedTarget as Element | null;
    if (relatedTarget && target.contains(relatedTarget)) return;

    state.hoveredNodeId = null;
    hideOverlay(state.hoverOverlay);
  });

  const updateOverlays = debounce(function () {
    if (state.inspectMode && state.hoveredNodeId) showHoverOverlay(state.hoveredNodeId);
    if (state.selectedNodeId) showSelectionOverlay(state.selectedNodeId);
  }, 16);

  window.addEventListener("scroll", updateOverlays, true);
  window.addEventListener("resize", updateOverlays);
}

// --- Color mode ---

export function setColorMode(mode: string): void {
  document.documentElement.setAttribute("data-theme", mode);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(mode);
}

// --- Page type helpers ---

export { isMarkdownPage, isMdxPage } from "./bridge-config.ts";
