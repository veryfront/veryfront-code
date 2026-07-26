/**
 * Bridge Inspector
 *
 * Overlays, DOM tree building, inspect mode, and mutation observer.
 */

import { DOM_IGNORE_TAGS, state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import {
  DATA_HTML2CANVAS_IGNORE,
  DATA_NODE_COLUMN,
  DATA_NODE_FILE,
  DATA_NODE_ID,
  DATA_NODE_LINE,
  DATA_NODE_NAME,
  DATA_NODE_SOURCE,
  DATA_VF_ID,
  DATA_VF_IGNORE,
  DATA_VF_SELECTOR,
  DATA_VF_TEXT,
} from "./bridge-constants.ts";
import { postToStudio } from "./bridge-messaging.ts";
import { getStudioLocationHref } from "./bridge-location.ts";
import { sanitizeStudioSourcePath } from "./bridge-source-path.ts";
import {
  MAX_STUDIO_CONFIG_PATH_LENGTH,
  MAX_STUDIO_MESSAGE_ID_LENGTH,
  MAX_STUDIO_NAVIGATOR_DEPTH,
  MAX_STUDIO_NAVIGATOR_NODES,
} from "../limits.ts";

const MAX_DOM_VISITS = 10_000;
const MAX_NODE_ID_LENGTH = MAX_STUDIO_MESSAGE_ID_LENGTH;
const MAX_NODE_NAME_LENGTH = 256;
const MAX_NODE_PATH_LENGTH = MAX_STUDIO_CONFIG_PATH_LENGTH;
const MAX_NODE_TEXT_LENGTH = 200;
const MAX_TEXT_SCAN_LENGTH = 4_096;
const MAX_SOURCE_HASH_LENGTH = 256;
const MAX_SOURCE_POSITION = 10_000_000;
const TREE_UPDATE_DEBOUNCE_MS = 150;
const TREE_UPDATE_MAX_WAIT_MS = 1_000;

// --- Overlay helpers ---

export function createOverlay(type: string): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "vf-overlay vf-overlay-" + type;
  overlay.setAttribute(DATA_VF_IGNORE, "true");
  overlay.setAttribute(DATA_HTML2CANVAS_IGNORE, "true");

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

function positionOverlay(
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

function getNodeName(element: Element): string {
  const vfId = boundedAttribute(element, DATA_VF_ID, MAX_NODE_ID_LENGTH);
  const componentName = vfId?.split("_")[0] ?? "";
  if (componentName) return componentName.slice(0, MAX_NODE_NAME_LENGTH);
  try {
    return element.tagName.slice(0, MAX_NODE_NAME_LENGTH).toLowerCase() || "element";
  } catch {
    return "element";
  }
}

const NODE_ID_ATTRIBUTES = [DATA_VF_ID, DATA_NODE_ID, DATA_VF_SELECTOR] as const;
let navigatorElementIds = new WeakMap<Element, string>();
let navigatorElementsById = new Map<string, Element>();
const bridgeCreatedSelectorAttributes = new Map<Element, string>();
let bridgeGeneratedCanonicalIds = new WeakMap<Element, string>();
let selectorDecorationOptOut = new WeakSet<Element>();
let navigatorMapInitialized = false;
let navigatorRoot: Element | null = null;

/** Test-only visibility into the bounded selector ownership registry. */
export function _bridgeCreatedSelectorCountForTest(): number {
  return bridgeCreatedSelectorAttributes.size;
}

function selectorAttributeIsPresent(element: Element): boolean {
  try {
    return element.hasAttribute(DATA_VF_SELECTOR);
  } catch {
    // An unreadable DOM facade is not safe to mutate.
    return true;
  }
}

function discardExternallyChangedSelectorOwnership(): void {
  for (const [element, expectedSelector] of bridgeCreatedSelectorAttributes) {
    try {
      if (element.getAttribute(DATA_VF_SELECTOR) === expectedSelector) continue;
    } catch {
      // Drop ownership when the current value cannot be verified.
    }
    bridgeCreatedSelectorAttributes.delete(element);
    selectorDecorationOptOut.add(element);
  }
}

function reconcileBridgeCreatedSelectorAttributes(
  currentElements: WeakMap<Element, string>,
): void {
  for (const [element, expectedSelector] of bridgeCreatedSelectorAttributes) {
    let stillOwned = false;
    try {
      stillOwned = element.getAttribute(DATA_VF_SELECTOR) === expectedSelector;
    } catch {
      // Unverifiable attributes are no longer bridge-owned.
    }
    if (!stillOwned) {
      bridgeCreatedSelectorAttributes.delete(element);
      selectorDecorationOptOut.add(element);
      continue;
    }
    if (currentElements.has(element)) continue;

    try {
      element.removeAttribute(DATA_VF_SELECTOR);
    } catch {
      // A detached or hostile facade must not remain strongly retained.
    }
    bridgeCreatedSelectorAttributes.delete(element);
  }
}

export function findElementById(nodeId: string | null): Element | null {
  if (!nodeId) return null;
  const mapped = navigatorElementsById.get(nodeId);
  if (mapped && (mapped as Element & { isConnected?: boolean }).isConnected !== false) {
    return mapped;
  }
  if (navigatorMapInitialized) return null;

  const escape = globalThis.CSS?.escape;
  if (typeof escape === "function" && typeof document.querySelector === "function") {
    let exactSelectorsAvailable = true;
    for (const attribute of NODE_ID_ATTRIBUTES) {
      try {
        const candidate: Element | null = document.querySelector(
          `[${attribute}="${escape(nodeId)}"]`,
        );
        if (candidate?.getAttribute(attribute) === nodeId) return candidate;
      } catch {
        exactSelectorsAvailable = false;
        break;
      }
    }
    if (exactSelectorsAvailable) return null;
  }

  let collection: IndexedCollection<Element> | null = null;
  try {
    if (typeof document.getElementsByTagName === "function") {
      collection = document.getElementsByTagName("*") as unknown as IndexedCollection<Element>;
    }
  } catch {
    return null;
  }
  if (!collection) return null;

  const matches: Array<Element | null> = NODE_ID_ATTRIBUTES.map(() => null);
  const limit = boundedCollectionLength(collection, MAX_DOM_VISITS);
  for (let index = 0; index < limit; index++) {
    const element = readCollectionItem(collection, index);
    if (!element) continue;
    for (let attributeIndex = 0; attributeIndex < NODE_ID_ATTRIBUTES.length; attributeIndex++) {
      if (matches[attributeIndex]) continue;
      try {
        if (element.getAttribute(NODE_ID_ATTRIBUTES[attributeIndex]!) === nodeId) {
          matches[attributeIndex] = element;
        }
      } catch {
        // Ignore detached or hostile DOM facades at the message boundary.
      }
    }
  }
  return matches.find((candidate) => candidate !== null) ?? null;
}

// --- Tree building ---

type NavigatorTreeNodeType = "root" | "component" | "element" | "markdown" | "text";

export interface NavigatorTreeNode {
  id: string;
  name: string;
  type: NavigatorTreeNodeType;
  path: string;
  parentId: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  children: NavigatorTreeNode[];
  text?: string;
  isRemote: boolean;
}

function isValidElement(el: Element): boolean {
  return (
    !!el &&
    el.nodeType === Node.ELEMENT_NODE &&
    !DOM_IGNORE_TAGS.includes(el.tagName) &&
    !el.hasAttribute(DATA_VF_IGNORE) &&
    (el as HTMLElement).style.display !== "none"
  );
}

function getNodeType(el: Element): Exclude<NavigatorTreeNodeType, "root"> {
  const vfId = el.getAttribute(DATA_VF_ID) || "";
  if (vfId && /^[A-Z]/.test(vfId)) return "component";
  if (el.hasAttribute(DATA_VF_TEXT)) return "text";
  if (el.getAttribute(DATA_NODE_SOURCE) === "md") return "markdown";

  return "element";
}

function parseSourcePosition(value: string | null): number {
  if (!value || !/^\d{1,8}$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_SOURCE_POSITION ? parsed : 0;
}

function boundedAttribute(element: Element, name: string, maxLength: number): string {
  try {
    const value = element.getAttribute(name);
    return value && value.length <= maxLength && !value.includes("\0") ? value : "";
  } catch {
    return "";
  }
}

interface IndexedCollection<T> {
  readonly length: number;
  readonly [index: number]: T;
  item?(index: number): T | null;
}

interface CollectionFrame<T> {
  collection: IndexedCollection<T>;
  index: number;
  limit: number;
}

function boundedCollectionLength(collection: IndexedCollection<unknown>, limit: number): number {
  try {
    const length = collection.length;
    return Number.isSafeInteger(length) && length > 0 ? Math.min(length, limit) : 0;
  } catch {
    return 0;
  }
}

function readCollectionItem<T>(collection: IndexedCollection<T>, index: number): T | null {
  try {
    if (typeof collection.item === "function") return collection.item(index);
    return collection[index] ?? null;
  } catch {
    return null;
  }
}

function collectionFrame<T>(
  collection: IndexedCollection<T> | null | undefined,
  limit: number,
): CollectionFrame<T> | null {
  if (!collection) return null;
  const length = boundedCollectionLength(collection, limit);
  return length > 0 ? { collection, index: 0, limit: length } : null;
}

function collectBoundedText(element: Element, descendants: boolean): string {
  const initialFrame = collectionFrame(
    element.childNodes as unknown as IndexedCollection<Node>,
    MAX_DOM_VISITS,
  );
  const stack: CollectionFrame<Node>[] = initialFrame ? [initialFrame] : [];
  let output = "";
  let scanned = 0;
  let visited = 0;

  while (
    stack.length > 0 && output.length < MAX_NODE_TEXT_LENGTH &&
    scanned < MAX_TEXT_SCAN_LENGTH && visited < MAX_DOM_VISITS
  ) {
    const frame = stack.at(-1)!;
    if (frame.index >= frame.limit) {
      stack.pop();
      continue;
    }
    const node = readCollectionItem(frame.collection, frame.index++);
    if (!node) continue;
    visited++;
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent ?? "";
      for (
        let index = 0;
        index < content.length && output.length < MAX_NODE_TEXT_LENGTH &&
        scanned < MAX_TEXT_SCAN_LENGTH;
        index++
      ) {
        const character = content[index]!;
        scanned++;
        if (output.length === 0 && /\s/.test(character)) continue;
        output += character;
      }
      continue;
    }
    if (!descendants) continue;
    if (node.nodeType !== Node.ELEMENT_NODE || !isValidElement(node as Element)) continue;
    const childFrame = collectionFrame(
      node.childNodes as unknown as IndexedCollection<Node>,
      MAX_DOM_VISITS - visited,
    );
    if (childFrame) stack.push(childFrame);
  }

  return output.trimEnd();
}

function getElementId(element: Element): string | null {
  const mapped = navigatorElementIds.get(element);
  if (mapped) return mapped;
  return boundedAttribute(element, DATA_VF_ID, MAX_NODE_ID_LENGTH) ||
    boundedAttribute(element, DATA_NODE_ID, MAX_NODE_ID_LENGTH) ||
    boundedAttribute(element, DATA_VF_SELECTOR, MAX_NODE_ID_LENGTH) || null;
}

/** Build the bounded node details emitted when an element is selected. */
export function buildSelectedNodeDetails(element: Element): {
  name: string;
  type: Exclude<NavigatorTreeNodeType, "root">;
  file: string;
  line: number;
  column: number;
  text: string;
} {
  const config = getConfig();
  const sourcePath = sanitizeStudioSourcePath(
    boundedAttribute(element, DATA_NODE_FILE, MAX_NODE_PATH_LENGTH),
    "project-relative",
  ) ?? "";
  return {
    name: boundedAttribute(element, DATA_NODE_NAME, MAX_NODE_NAME_LENGTH) ||
      element.tagName.toLowerCase().slice(0, MAX_NODE_NAME_LENGTH),
    type: getNodeType(element),
    file: sourcePath || sanitizeStudioSourcePath(config.pagePath, "project-relative") || "",
    line: parseSourcePosition(element.getAttribute(DATA_NODE_LINE)),
    column: parseSourcePosition(element.getAttribute(DATA_NODE_COLUMN)),
    text: collectBoundedText(element, false),
  };
}

export function buildNavigatorTree(root: Element): NavigatorTreeNode {
  discardExternallyChangedSelectorOwnership();
  const config = getConfig();
  const pagePath = sanitizeStudioSourcePath(config.pagePath, "project-relative") ?? "";
  let nodeIndex = 0;
  let nodeCount = 0;
  let visitedElements = 0;
  const reservedIds = new Set<string>();
  const sourceIdCounts = new Map<string, number>();
  const childCache = new WeakMap<object, Element[]>();
  let remainingCollectionReads = MAX_DOM_VISITS;
  const nextElementIds = new WeakMap<Element, string>();
  const nextElementsById = new Map<string, Element>();
  const usedCanonicalIds = new Set<string>(["root"]);
  nextElementIds.set(root, "root");
  nextElementsById.set("root", root);

  function sourceElementId(element: Element): string | null {
    return boundedAttribute(element, DATA_VF_ID, MAX_NODE_ID_LENGTH) ||
      boundedAttribute(element, DATA_NODE_ID, MAX_NODE_ID_LENGTH) || null;
  }

  function reserveElementIds(element: Element, countSourceId = true): void {
    for (const attribute of NODE_ID_ATTRIBUTES) {
      const value = boundedAttribute(element, attribute, MAX_NODE_ID_LENGTH);
      if (value) reservedIds.add(value);
    }
    if (countSourceId) {
      const sourceId = sourceElementId(element);
      if (sourceId) sourceIdCounts.set(sourceId, (sourceIdCounts.get(sourceId) ?? 0) + 1);
    }
  }

  function scanChildren(element: Element): Element[] {
    const cached = childCache.get(element);
    if (cached) return cached;
    const children: Element[] = [];
    if (remainingCollectionReads > 0) {
      const collection = element.children as unknown as IndexedCollection<Element> | undefined;
      if (collection) {
        const length = boundedCollectionLength(collection, remainingCollectionReads);
        for (let index = 0; index < length; index++) {
          remainingCollectionReads--;
          const child = readCollectionItem(collection, index);
          if (child) children.push(child);
        }
      }
    }
    childCache.set(element, children);
    return children;
  }

  reserveElementIds(root, false);
  const scanStack: Element[] = [root];
  let scannedElements = 0;
  while (scanStack.length > 0 && scannedElements <= MAX_DOM_VISITS) {
    const element = scanStack.pop()!;
    if (element !== root) {
      scannedElements++;
      if (element.nodeType !== Node.ELEMENT_NODE) continue;
      if (!isValidElement(element)) continue;
      reserveElementIds(element);
    }
    const children = scanChildren(element);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]!;
      if (child.nodeType === Node.ELEMENT_NODE) scanStack.push(child);
    }
  }

  function allocateElementId(element: Element): string {
    let tagComponent = "element";
    try {
      const normalized = element.tagName.slice(0, 64).toLowerCase().replace(
        /[^a-z0-9-]+/g,
        "-",
      ).replace(/^-+|-+$/g, "");
      if (normalized) tagComponent = normalized;
    } catch {
      // Keep the generic component when a detached facade cannot expose its tag.
    }
    let candidate: string;
    do {
      candidate = "vf-" + tagComponent + "-" + ++nodeIndex;
    } while (reservedIds.has(candidate) || usedCanonicalIds.has(candidate));
    reservedIds.add(candidate);
    usedCanonicalIds.add(candidate);
    return candidate;
  }

  function processElement(
    el: Element,
    parentId: string,
    depth: number,
  ): NavigatorTreeNode[] {
    if (++visitedElements > MAX_DOM_VISITS || depth > MAX_STUDIO_NAVIGATOR_DEPTH) return [];
    if (!isValidElement(el)) return [];
    if (nodeCount >= MAX_STUDIO_NAVIGATOR_NODES) return [];
    nodeCount++;

    const sourceId = sourceElementId(el);
    const selectorId = boundedAttribute(el, DATA_VF_SELECTOR, MAX_NODE_ID_LENGTH);
    const selectorPresent = selectorAttributeIsPresent(el);
    const previousId = navigatorElementIds.get(el);
    const previousGeneratedId = bridgeGeneratedCanonicalIds.get(el);
    const uniqueSourceId = sourceId && sourceIdCounts.get(sourceId) === 1 ? sourceId : null;
    const reusableGeneratedId = previousGeneratedId && previousId === previousGeneratedId &&
        !usedCanonicalIds.has(previousGeneratedId) &&
        (
          bridgeCreatedSelectorAttributes.get(el) === previousGeneratedId ||
          !reservedIds.has(previousGeneratedId)
        )
      ? previousGeneratedId
      : null;
    const reusablePreviousId = previousId && previousId !== "root" &&
        !usedCanonicalIds.has(previousId) &&
        (previousId === selectorId || previousId === uniqueSourceId)
      ? previousId
      : null;
    let generatedId = reusableGeneratedId;
    let id = generatedId || reusablePreviousId ||
      (uniqueSourceId && !usedCanonicalIds.has(uniqueSourceId) ? uniqueSourceId : "") ||
      (selectorId && !usedCanonicalIds.has(selectorId) ? selectorId : "");
    if (!id) {
      id = allocateElementId(el);
      generatedId = id;
    }
    if (generatedId === id) {
      bridgeGeneratedCanonicalIds.set(el, id);
      if (!selectorPresent && !selectorDecorationOptOut.has(el)) {
        try {
          el.setAttribute(DATA_VF_SELECTOR, id);
          bridgeCreatedSelectorAttributes.set(el, id);
        } catch {
          selectorDecorationOptOut.add(el);
        }
      }
    } else {
      bridgeGeneratedCanonicalIds.delete(el);
    }
    usedCanonicalIds.add(id);
    nextElementIds.set(el, id);
    nextElementsById.set(id, el);

    const vfId = boundedAttribute(el, DATA_VF_ID, MAX_NODE_ID_LENGTH);
    const componentName = vfId?.split("_")[0] ?? "";
    let fallbackName = "element";
    try {
      fallbackName = el.tagName.slice(0, MAX_NODE_NAME_LENGTH).toLowerCase() || "element";
    } catch {
      // Keep the schema-valid generic name.
    }
    const name = (componentName || fallbackName).slice(0, MAX_NODE_NAME_LENGTH) || "element";

    const node: NavigatorTreeNode = {
      id: id,
      name: name,
      type: getNodeType(el),
      path: pagePath,
      parentId: parentId,
      start: {
        line: parseSourcePosition(el.getAttribute(DATA_NODE_LINE)),
        column: parseSourcePosition(el.getAttribute(DATA_NODE_COLUMN)),
      },
      end: { line: 0, column: 0 },
      children: [],
      text: el.hasAttribute(DATA_VF_TEXT) ? collectBoundedText(el, true) : undefined,
      isRemote: false,
    };

    const children = childCache.get(el) ?? [];
    for (const child of children) {
      if (
        visitedElements >= MAX_DOM_VISITS || nodeCount >= MAX_STUDIO_NAVIGATOR_NODES
      ) break;
      node.children.push(...processElement(child, id!, depth + 1));
    }

    return [node];
  }

  const rootNode: NavigatorTreeNode = {
    id: "root",
    name: "root",
    type: "root",
    path: "",
    parentId: "",
    start: { line: 0, column: 0 },
    end: { line: 0, column: 0 },
    children: [],
    isRemote: false,
  };

  const children = childCache.get(root) ?? [];
  for (const child of children) {
    if (visitedElements >= MAX_DOM_VISITS || nodeCount >= MAX_STUDIO_NAVIGATOR_NODES) break;
    rootNode.children.push(...processElement(child, "root", 0));
  }

  navigatorElementIds = nextElementIds;
  navigatorElementsById = nextElementsById;
  reconcileBridgeCreatedSelectorAttributes(nextElementIds);
  navigatorMapInitialized = true;
  navigatorRoot = root;

  return rootNode;
}

function readSourceHash(): string | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__VERYFRONT_SOURCE_HASH__");
    return descriptor && !descriptor.get && !descriptor.set &&
        typeof descriptor.value === "string" && descriptor.value.length <= MAX_SOURCE_HASH_LENGTH
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

let treeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let treeUpdateMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let mutationObserver: MutationObserver | null = null;

export function disposeInspectorTimers(): void {
  if (treeUpdateTimer !== null) {
    clearTimeout(treeUpdateTimer);
    treeUpdateTimer = null;
  }
  if (treeUpdateMaxWaitTimer !== null) {
    clearTimeout(treeUpdateMaxWaitTimer);
    treeUpdateMaxWaitTimer = null;
  }
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

function sendTreeUpdate(): void {
  const config = getConfig();
  const root = document.getElementById("root") || document.body;
  if (!root) return;
  const tree = buildNavigatorTree(root);

  if (state.selectedNodeId) {
    if (navigatorElementsById.has(state.selectedNodeId)) {
      showSelectionOverlay(state.selectedNodeId);
    } else {
      state.selectedNodeId = null;
      hideOverlay(state.selectionOverlay);
      postToStudio({ action: "setSelectedNode", id: null });
    }
  }
  if (state.hoveredNodeId) {
    if (navigatorElementsById.has(state.hoveredNodeId)) {
      showHoverOverlay(state.hoveredNodeId);
    } else {
      state.hoveredNodeId = null;
      hideOverlay(state.hoverOverlay);
    }
  }

  postToStudio({
    action: "treeUpdated",
    id: config.pageId,
    url: getStudioLocationHref(),
    tree,
    sourceHash: readSourceHash(),
  });
}

function flushScheduledTreeUpdate(): void {
  if (treeUpdateTimer === null && treeUpdateMaxWaitTimer === null) return;
  if (treeUpdateTimer !== null) clearTimeout(treeUpdateTimer);
  if (treeUpdateMaxWaitTimer !== null) clearTimeout(treeUpdateMaxWaitTimer);
  treeUpdateTimer = null;
  treeUpdateMaxWaitTimer = null;
  sendTreeUpdate();
}

function debouncedTreeUpdate(): void {
  if (treeUpdateTimer !== null) clearTimeout(treeUpdateTimer);
  treeUpdateTimer = setTimeout(flushScheduledTreeUpdate, TREE_UPDATE_DEBOUNCE_MS);
  treeUpdateMaxWaitTimer ??= setTimeout(
    flushScheduledTreeUpdate,
    TREE_UPDATE_MAX_WAIT_MS,
  );
}

function mutationTargetElement(target: Node): Element | null {
  try {
    if (target.nodeType === 1) return target as Element;
    return (target as Node & { parentElement?: Element | null }).parentElement ?? null;
  } catch {
    return null;
  }
}

function isWithinIgnoredSubtree(target: Node): boolean {
  let element = mutationTargetElement(target);
  for (let depth = 0; element && depth <= MAX_STUDIO_NAVIGATOR_DEPTH; depth++) {
    try {
      if (element.hasAttribute(DATA_VF_IGNORE)) return true;
      element = element.parentElement;
    } catch {
      return false;
    }
  }
  return false;
}

function mutationCollectionIsIgnored(nodes: NodeList): boolean {
  const collection = nodes as unknown as IndexedCollection<Node>;
  let length: number;
  try {
    length = collection.length;
  } catch {
    return false;
  }
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_DOM_VISITS) return false;
  for (let index = 0; index < length; index++) {
    const node = readCollectionItem(collection, index);
    if (!node || !isWithinIgnoredSubtree(node)) return false;
  }
  return true;
}

function nodeIsWithinNavigatorRoot(target: Node, root: Element): boolean {
  if (target === root) return true;
  try {
    if (typeof root.contains === "function") return root.contains(target);
  } catch {
    return false;
  }

  let element = mutationTargetElement(target);
  for (let depth = 0; element && depth <= MAX_STUDIO_NAVIGATOR_DEPTH + 1; depth++) {
    if (element === root) return true;
    try {
      element = element.parentElement;
    } catch {
      return false;
    }
  }
  return false;
}

function isRelevantMutation(
  mutation: MutationRecord,
  root: Element,
  rootChanged: boolean,
): boolean {
  if (
    mutation.type !== "childList" && mutation.type !== "characterData" &&
    mutation.type !== "attributes"
  ) return false;
  if (rootChanged) return true;
  if (mutation.type === "attributes" && mutation.attributeName === "id") return false;
  if (!nodeIsWithinNavigatorRoot(mutation.target, root)) return false;
  if (mutation.type === "attributes" && mutation.attributeName === DATA_VF_IGNORE) return true;
  if (isWithinIgnoredSubtree(mutation.target)) return false;
  if (mutation.type !== "childList") return true;

  const added = mutation.addedNodes as unknown as IndexedCollection<Node>;
  const removed = mutation.removedNodes as unknown as IndexedCollection<Node>;
  const hasAdded = boundedCollectionLength(added, 1) > 0;
  const hasRemoved = boundedCollectionLength(removed, 1) > 0;
  return !(
    (!hasAdded || mutationCollectionIsIgnored(mutation.addedNodes)) &&
    (!hasRemoved || mutationCollectionIsIgnored(mutation.removedNodes))
  );
}

export function setupMutationObserver(): void {
  const root = document.getElementById("root") || document.body;
  if (!root) return;

  mutationObserver?.disconnect();

  mutationObserver = new MutationObserver(function (mutations) {
    const currentRoot = document.getElementById("root") || document.body;
    const previousRoot = navigatorRoot ?? root;
    const rootChanged = !!currentRoot && currentRoot !== previousRoot;
    const hasRelevantChanges = mutations.some((mutation) =>
      isRelevantMutation(mutation, previousRoot, rootChanged)
    );
    if (!hasRelevantChanges) return;

    // Deselect if the selected element was removed from the DOM
    if (state.selectedNodeId && !findElementById(state.selectedNodeId)) {
      state.selectedNodeId = null;
      hideOverlay(state.selectionOverlay);
      postToStudio({ action: "setSelectedNode", id: null });
    }

    debouncedTreeUpdate();
  });

  const observerTarget = document.documentElement || document.body || root;
  mutationObserver.observe(observerTarget, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      DATA_VF_ID,
      DATA_VF_IGNORE,
      DATA_VF_SELECTOR,
      DATA_VF_TEXT,
      DATA_NODE_ID,
      DATA_NODE_NAME,
      DATA_NODE_FILE,
      DATA_NODE_LINE,
      DATA_NODE_COLUMN,
      DATA_NODE_SOURCE,
      "id",
      "style",
    ],
    subtree: true,
  });
  sendTreeUpdate();
}

// --- Show/hide overlays for specific nodes ---

function showOverlay(overlay: HTMLElement | null, nodeId: string | null): void {
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
  const el = findElementById(nodeId);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// --- Inspect mode ---

let inspectModeInitialized = false;
let disposeInspectListeners: (() => void) | null = null;

function closestInspectableElement(target: EventTarget | null, selector: string): Element | null {
  if (!target || typeof (target as Partial<Element>).closest !== "function") return null;
  try {
    const targetElement = target as Element;
    if (isWithinIgnoredSubtree(targetElement)) return null;

    const candidate = targetElement.closest(selector);
    const root = navigatorRoot ?? document.getElementById?.("root") ?? document.body;
    if (
      !candidate || !root || !nodeIsWithinNavigatorRoot(candidate, root) ||
      isWithinIgnoredSubtree(candidate) || !isValidElement(candidate) ||
      (navigatorMapInitialized && !navigatorElementIds.has(candidate))
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function setupInspectMode(): void {
  if (inspectModeInitialized) return;
  inspectModeInitialized = true;
  const INSPECTABLE_SELECTOR = "[" + DATA_VF_ID + "], [" + DATA_VF_SELECTOR + "], [" +
    DATA_NODE_ID + "], [" + DATA_NODE_FILE + "]";

  const installedDocument = document;
  const installedWindow = window;
  const clickHandler = function (event: MouseEvent) {
    if (!state.inspectMode) return;

    event.preventDefault();
    event.stopPropagation();

    const target = closestInspectableElement(event.target, INSPECTABLE_SELECTOR);
    if (!target) {
      state.selectedNodeId = null;
      hideOverlay(state.selectionOverlay);
      postToStudio({ action: "setSelectedNode", id: null });
      return;
    }

    const id = getElementId(target);
    if (!id) return;
    state.selectedNodeId = id;
    showSelectionOverlay(id);
    postToStudio({
      action: "setSelectedNode",
      id: id,
      node: buildSelectedNodeDetails(target),
    });
  };
  installedDocument.addEventListener("click", clickHandler, true);

  const pointerOverHandler = function (event: PointerEvent) {
    if (!state.inspectMode || (event as PointerEvent).pointerType === "touch") return;

    const target = closestInspectableElement(event.target, INSPECTABLE_SELECTOR);
    if (!target) return;

    const id = getElementId(target);
    if (!id) return;
    if (id === state.hoveredNodeId) return;

    state.hoveredNodeId = id;
    showHoverOverlay(id);
  };
  installedDocument.addEventListener("pointerover", pointerOverHandler);

  const pointerOutHandler = function (event: PointerEvent) {
    if (!state.inspectMode || (event as PointerEvent).pointerType === "touch") return;

    const target = closestInspectableElement(event.target, INSPECTABLE_SELECTOR);
    if (!target) return;

    const relatedTarget = (event as PointerEvent).relatedTarget;
    if (
      relatedTarget && typeof (relatedTarget as Partial<Node>).nodeType === "number" &&
      target.contains(relatedTarget as Node)
    ) return;

    state.hoveredNodeId = null;
    hideOverlay(state.hoverOverlay);
  };
  installedDocument.addEventListener("pointerout", pointerOutHandler);

  let overlayFrame: number | null = null;
  let overlayFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const flushOverlayUpdate = () => {
    overlayFrame = null;
    overlayFallbackTimer = null;
    if (state.inspectMode && state.hoveredNodeId) showHoverOverlay(state.hoveredNodeId);
    if (state.selectedNodeId) showSelectionOverlay(state.selectedNodeId);
  };
  const updateOverlays = () => {
    if (overlayFrame !== null || overlayFallbackTimer !== null) return;
    if (typeof installedWindow.requestAnimationFrame === "function") {
      overlayFrame = installedWindow.requestAnimationFrame(flushOverlayUpdate);
      return;
    }
    overlayFallbackTimer = setTimeout(flushOverlayUpdate, 16);
  };

  installedWindow.addEventListener("scroll", updateOverlays, true);
  installedWindow.addEventListener("resize", updateOverlays);
  disposeInspectListeners = () => {
    installedDocument.removeEventListener("click", clickHandler, true);
    installedDocument.removeEventListener("pointerover", pointerOverHandler);
    installedDocument.removeEventListener("pointerout", pointerOutHandler);
    installedWindow.removeEventListener("scroll", updateOverlays, true);
    installedWindow.removeEventListener("resize", updateOverlays);
    if (overlayFrame !== null && typeof installedWindow.cancelAnimationFrame === "function") {
      installedWindow.cancelAnimationFrame(overlayFrame);
      overlayFrame = null;
    }
    if (overlayFallbackTimer !== null) {
      clearTimeout(overlayFallbackTimer);
      overlayFallbackTimer = null;
    }
  };
}

/** Remove inspector listeners, observers, and pending timers owned by the bridge. */
export function disposeInspector(): void {
  disposeInspectorTimers();
  disposeInspectListeners?.();
  disposeInspectListeners = null;
  inspectModeInitialized = false;
  for (const [element, selector] of bridgeCreatedSelectorAttributes) {
    try {
      if (element.getAttribute(DATA_VF_SELECTOR) === selector) {
        element.removeAttribute(DATA_VF_SELECTOR);
      }
    } catch {
      // Detached or hostile element facades must not prevent bridge teardown.
    }
  }
  bridgeCreatedSelectorAttributes.clear();
  bridgeGeneratedCanonicalIds = new WeakMap();
  selectorDecorationOptOut = new WeakSet();
  navigatorElementIds = new WeakMap();
  navigatorElementsById.clear();
  navigatorMapInitialized = false;
  navigatorRoot = null;
}

// --- Color mode ---

export function setColorMode(mode: string): boolean {
  if (mode !== "light" && mode !== "dark") return false;
  document.documentElement.setAttribute("data-theme", mode);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(mode);
  return true;
}
