import {
  aggregateManagedHeadDescriptors,
  BOOLEAN_HEAD_ATTRIBUTES,
  escapeManagedHeadRawText,
  HEAD_LEGACY_MANAGED_ATTRIBUTE,
  HEAD_MANAGER_RETIRE_SYMBOL,
  HEAD_PROVENANCE_ATTRIBUTE,
  HEAD_REACT_MANAGED_ATTRIBUTE,
  HEAD_REACT_OWNER_ATTRIBUTE,
  HEAD_ROUTE_MANAGED_ATTRIBUTE,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  headLinkSingletonKeyFromRecord,
  headMetaSingletonKeyFromRecord,
  headScriptKeysIntersect,
  isHeadFrameworkAttribute,
  type ManagedHeadAttribute,
  type ManagedHeadDescriptor,
} from "./managed-head-protocol.ts";

const HEAD_MANAGER_STATE_SYMBOL = Symbol.for(
  "veryfront.client-head-manager.v2",
);

// SPA route payloads do not carry a complete normalized document head. Keep
// app-wide singletons that the destination cannot reconstruct; every other
// framework-owned node is page authority and must be retired at handoff.
const CROSS_PAGE_PRESERVED_SINGLETON_KEYS = new Set([
  "meta:viewport",
  "link:manifest",
]);

interface ClientHeadRegistration {
  anchor: Element | null;
  descriptors: readonly ManagedHeadDescriptor[];
  active: boolean;
  readonly sequence: number;
}

interface ClientHeadRecord {
  readonly descriptor: ManagedHeadDescriptor;
  readonly element: Element;
  /** Original shell or route node restored when React releases ownership. */
  readonly baselineFallback?: HeadBaselineSnapshot;
  /** A mismatched SSR script retained to avoid executing client code twice. */
  readonly retainedHydrationScript?: boolean;
}

interface HeadBaselineSnapshot {
  readonly attributes: readonly ManagedHeadAttribute[];
  readonly content: string;
  readonly provenance: "route" | "shell";
}

export interface ClientHeadManager {
  update(
    owner: object,
    anchor: Element | null,
    descriptors: readonly ManagedHeadDescriptor[],
  ): void;
  deactivate(owner: object): void;
  retire(): void;
}

interface ClientHeadManagerState {
  readonly documents: WeakMap<Document, ClientHeadManager>;
}

function getClientHeadManagerState(): ClientHeadManagerState {
  const globalState = globalThis as typeof globalThis & {
    [HEAD_MANAGER_STATE_SYMBOL]?: ClientHeadManagerState;
  };
  return globalState[HEAD_MANAGER_STATE_SYMBOL] ??= {
    documents: new WeakMap<Document, ClientHeadManager>(),
  };
}

export function getManagedHeadNonce(
  targetDocument: Document,
): string | undefined {
  const element = targetDocument.querySelector<HTMLElement>(
    "script[nonce], style[nonce], link[nonce]",
  );
  if (!element) return undefined;

  const nonce = element.nonce || element.getAttribute("nonce") || "";
  return nonce || undefined;
}

function compareHeadRegistrations(
  left: ClientHeadRegistration,
  right: ClientHeadRegistration,
): number {
  if (
    left.anchor?.isConnected &&
    right.anchor?.isConnected &&
    left.anchor.ownerDocument === right.anchor.ownerDocument
  ) {
    const position = left.anchor.compareDocumentPosition(right.anchor);
    if (position & 4) return -1; // Node.DOCUMENT_POSITION_FOLLOWING
    if (position & 2) return 1; // Node.DOCUMENT_POSITION_PRECEDING
  }
  return left.sequence - right.sequence;
}

function readElementAttributes(element: Element): ManagedHeadAttribute[] {
  const attributes: ManagedHeadAttribute[] = [];
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();
    if (isHeadFrameworkAttribute(name)) continue;

    const nonce = name === "nonce" && "nonce" in element ? (element as HTMLElement).nonce : "";
    const value = BOOLEAN_HEAD_ATTRIBUTES.has(name) ? "" : (nonce || attribute.value);
    attributes.push([name, value]);
  }
  return attributes.sort(([left], [right]) => left.localeCompare(right));
}

function elementMatchesDescriptor(
  element: Element,
  descriptor: ManagedHeadDescriptor,
): boolean {
  if (element.tagName.toLowerCase() !== descriptor.tagName) return false;
  if (
    JSON.stringify(readElementAttributes(element)) !==
      JSON.stringify(descriptor.attributes)
  ) {
    return false;
  }

  const expectedContent = descriptor.content ?? "";
  const actualContent = descriptor.contentMode === "html"
    ? element.innerHTML
    : (element.textContent ?? "");
  return actualContent === expectedContent ||
    actualContent === escapeManagedHeadRawText(
        expectedContent,
        descriptor.tagName,
      );
}

function elementContentMatchesDescriptor(
  element: Element,
  descriptor: ManagedHeadDescriptor,
): boolean {
  if (element.tagName.toLowerCase() !== descriptor.tagName) return false;
  const expectedContent = descriptor.content ?? "";
  const actualContent = descriptor.contentMode === "html"
    ? element.innerHTML
    : (element.textContent ?? "");
  return actualContent === expectedContent ||
    actualContent === escapeManagedHeadRawText(
        expectedContent,
        descriptor.tagName,
      );
}

function elementSingletonKey(element: Element): string | undefined {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "title") return "title";
  const attributes = Object.fromEntries(readElementAttributes(element));
  if (tagName === "meta") return headMetaSingletonKeyFromRecord(attributes);
  if (tagName === "link") return headLinkSingletonKeyFromRecord(attributes);
  return undefined;
}

function elementScriptKeys(element: Element): readonly string[] {
  if (element.tagName.toLowerCase() !== "script") return [];
  const keys: string[] = [];
  const id = element.getAttribute("id");
  const src = element.getAttribute("src");
  if (id) keys.push(`script:id:${id}`);
  if (src) keys.push(`script:src:${src}`);
  return keys;
}

function markHeadElementManaged(element: Element): void {
  element.removeAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE);
  element.removeAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE);
  element.setAttribute(HEAD_PROVENANCE_ATTRIBUTE, "true");
  element.setAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE, "1");
  element.setAttribute(HEAD_REACT_MANAGED_ATTRIBUTE, "true");
}

function captureHeadBaselineSnapshot(element: Element): HeadBaselineSnapshot | undefined {
  const routeOwned = element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true";
  const shellOwned = element.getAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE) === "true";
  if (!routeOwned && (!shellOwned || !elementSingletonKey(element))) return undefined;
  return {
    attributes: readElementAttributes(element),
    content: element.textContent ?? "",
    provenance: routeOwned ? "route" : "shell",
  };
}

function restoreHeadBaselineSnapshot(
  element: Element,
  snapshot: HeadBaselineSnapshot,
): void {
  for (const attribute of [...element.attributes]) {
    element.removeAttribute(attribute.name);
  }
  for (const [name, value] of snapshot.attributes) element.setAttribute(name, value);
  element.textContent = snapshot.content;
  element.removeAttribute(HEAD_PROVENANCE_ATTRIBUTE);
  element.removeAttribute(HEAD_REACT_MANAGED_ATTRIBUTE);
  if (snapshot.provenance === "route") {
    element.setAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE, "1");
    element.setAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE, "true");
  } else {
    element.removeAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE);
    element.setAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE, "true");
  }
}

function promoteToShellHeadBaseline(element: Element): void {
  for (const attribute of [...element.attributes]) {
    if (isHeadFrameworkAttribute(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
  element.setAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE, "true");
}

function isCrossPagePreservedSingleton(
  element: Element,
  singletonKey = elementSingletonKey(element),
): boolean {
  return element.parentElement !== null &&
    singletonKey !== undefined &&
    CROSS_PAGE_PRESERVED_SINGLETON_KEYS.has(singletonKey);
}

function isFrameworkOwnedHeadElement(element: Element): boolean {
  return element.getAttribute(HEAD_PROVENANCE_ATTRIBUTE) === "true" ||
    element.getAttribute(HEAD_REACT_MANAGED_ATTRIBUTE) === "true" ||
    element.getAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE) === "1" ||
    element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true" ||
    element.getAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE) === "true";
}

function retireFrameworkHeadElement(element: Element): void {
  if (isCrossPagePreservedSingleton(element)) {
    promoteToShellHeadBaseline(element);
    return;
  }
  element.remove();
}

function releaseHeadRecord(record: ClientHeadRecord, targetDocument: Document): void {
  if (
    record.baselineFallback &&
    record.element.parentElement === targetDocument.head
  ) {
    restoreHeadBaselineSnapshot(record.element, record.baselineFallback);
    return;
  }
  record.element.remove();
}

function applyDescriptorToElement(
  element: Element,
  descriptor: ManagedHeadDescriptor,
): void {
  for (const attribute of [...element.attributes]) {
    if (!isHeadFrameworkAttribute(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
  for (const [name, value] of descriptor.attributes) {
    element.setAttribute(name, value);
  }

  const content = descriptor.content ?? "";
  if (descriptor.contentMode === "html") element.innerHTML = content;
  else element.textContent = content;
  markHeadElementManaged(element);
}

function createClientHeadManager(targetDocument: Document): ClientHeadManager {
  const registrations = new Map<object, ClientHeadRegistration>();
  const initialSSRElements = new Set(
    [...targetDocument.head.children].filter((element) =>
      element.getAttribute(HEAD_PROVENANCE_ATTRIBUTE) === "true" &&
      element.getAttribute(HEAD_REACT_MANAGED_ATTRIBUTE) !== "true"
    ),
  );
  let records: ClientHeadRecord[] = [];
  let nextSequence = 0;
  let reconciliationScheduled = false;

  function isMarkedCandidate(
    element: Element,
    descriptor: ManagedHeadDescriptor,
  ): boolean {
    if (element.getAttribute(HEAD_PROVENANCE_ATTRIBUTE) === "true") return true;
    if (element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true") return true;
    return descriptor.singletonKey !== undefined &&
      element.getAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE) === "true" &&
      elementSingletonKey(element) === descriptor.singletonKey;
  }

  function findMarkedElement(
    descriptor: ManagedHeadDescriptor,
    unavailable: ReadonlySet<Element>,
    semanticOnly: boolean,
  ): Element | undefined {
    for (const element of [...targetDocument.head.children]) {
      if (
        unavailable.has(element) ||
        !isMarkedCandidate(element, descriptor)
      ) {
        continue;
      }
      if (semanticOnly) {
        if (
          descriptor.singletonKey &&
          elementSingletonKey(element) === descriptor.singletonKey
        ) {
          return element;
        }
      } else if (elementMatchesDescriptor(element, descriptor)) {
        return element;
      }
    }
    return undefined;
  }

  function findMarkedStyleByContent(
    descriptor: ManagedHeadDescriptor,
    unavailable: ReadonlySet<Element>,
  ): Element | undefined {
    if (descriptor.tagName !== "style") return undefined;
    for (const element of [...targetDocument.head.children]) {
      if (
        unavailable.has(element) ||
        element.getAttribute(HEAD_PROVENANCE_ATTRIBUTE) !== "true"
      ) {
        continue;
      }
      if (elementContentMatchesDescriptor(element, descriptor)) return element;
    }
    return undefined;
  }

  function removeConflictingScript(
    descriptor: ManagedHeadDescriptor,
    unavailable: ReadonlySet<Element>,
  ): void {
    if (descriptor.scriptKeys.length === 0) return;
    for (const element of [...targetDocument.head.children]) {
      if (
        !unavailable.has(element) &&
        element.getAttribute(HEAD_PROVENANCE_ATTRIBUTE) === "true" &&
        headScriptKeysIntersect(
          elementScriptKeys(element),
          descriptor.scriptKeys,
        )
      ) {
        element.remove();
      }
    }
  }

  function findUnclaimedExecutedScript(
    descriptor: ManagedHeadDescriptor,
    unavailable: ReadonlySet<Element>,
    previouslyManaged: ReadonlySet<Element>,
  ): Element | undefined {
    if (descriptor.tagName !== "script") return undefined;
    for (const element of [...targetDocument.head.children]) {
      if (
        !initialSSRElements.has(element) &&
        element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) !== "true"
      ) {
        continue;
      }
      if (
        unavailable.has(element) ||
        previouslyManaged.has(element) ||
        element.parentElement !== targetDocument.head ||
        element.tagName.toLowerCase() !== "script"
      ) {
        continue;
      }

      const existingKeys = elementScriptKeys(element);
      if (
        descriptor.scriptKeys.length > 0
          ? headScriptKeysIntersect(existingKeys, descriptor.scriptKeys)
          : existingKeys.length === 0
      ) {
        return element;
      }
    }
    return undefined;
  }

  function reconcile(): void {
    // Route replacement may disconnect a React root without running effects.
    for (const registration of registrations.values()) {
      if (registration.active && registration.anchor?.isConnected === false) {
        registration.active = false;
      }
    }

    const activeRegistrations = [...registrations.values()]
      .filter((registration) => registration.active)
      .sort(compareHeadRegistrations);
    const descriptors = aggregateManagedHeadDescriptors(
      activeRegistrations.flatMap((registration) => registration.descriptors),
    );
    const claimed = new Set<Element>();
    const previouslyManaged = new Set(records.map((record) => record.element));
    const nextRecords: ClientHeadRecord[] = [];

    // Reserve all exact matches first. This prevents an earlier anonymous
    // fallback from stealing the exact script belonging to a later descriptor.
    const exactReservations = new Map<number, Element>();
    const reservedElements = new Set<Element>();
    descriptors.forEach((descriptor, index) => {
      for (const element of [...targetDocument.head.children]) {
        if (
          reservedElements.has(element) ||
          !isMarkedCandidate(element, descriptor)
        ) {
          continue;
        }
        if (!elementMatchesDescriptor(element, descriptor)) continue;
        exactReservations.set(index, element);
        reservedElements.add(element);
        break;
      }
    });

    for (const [descriptorIndex, descriptor] of descriptors.entries()) {
      let element = exactReservations.get(descriptorIndex);
      let baselineFallback = element
        ? records.find((record) => record.element === element)?.baselineFallback ??
          captureHeadBaselineSnapshot(element)
        : undefined;
      if (element) {
        reservedElements.delete(element);
        markHeadElementManaged(element);
      }

      const reusableRecord = element
        ? undefined
        : records.find((record) =>
          !claimed.has(record.element) &&
          !reservedElements.has(record.element) &&
          record.descriptor.signature === descriptor.signature &&
          record.element.parentElement === targetDocument.head &&
          (
            elementMatchesDescriptor(record.element, descriptor) ||
            record.retainedHydrationScript === true
          )
        );
      element ??= reusableRecord?.element;
      baselineFallback ??= reusableRecord?.baselineFallback;
      let retainedHydrationScript = reusableRecord?.retainedHydrationScript === true;

      if (
        !element &&
        descriptor.singletonKey &&
        descriptor.tagName !== "script"
      ) {
        const singletonRecord = records.find((record) =>
          !claimed.has(record.element) &&
          !reservedElements.has(record.element) &&
          record.descriptor.singletonKey === descriptor.singletonKey &&
          record.element.parentElement === targetDocument.head
        );
        element = singletonRecord?.element;
        baselineFallback ??= singletonRecord?.baselineFallback;
        if (element) applyDescriptorToElement(element, descriptor);
      }

      const unavailable = () => new Set([...claimed, ...reservedElements]);
      if (!element) {
        element = findMarkedElement(descriptor, unavailable(), false);
        if (element) {
          baselineFallback ??= captureHeadBaselineSnapshot(element);
          markHeadElementManaged(element);
        }
      }

      if (
        !element &&
        descriptor.singletonKey &&
        descriptor.tagName !== "script"
      ) {
        element = findMarkedElement(descriptor, unavailable(), true);
        if (element) {
          baselineFallback ??= captureHeadBaselineSnapshot(element);
          applyDescriptorToElement(element, descriptor);
        }
      }

      if (!element) {
        element = findMarkedStyleByContent(descriptor, unavailable());
        if (element) applyDescriptorToElement(element, descriptor);
      }

      if (!element) {
        element = findUnclaimedExecutedScript(
          descriptor,
          unavailable(),
          previouslyManaged,
        );
        if (element) {
          // This SSR or route-directive script already executed. Retain it
          // fail-closed during the first React adoption; only a later prop
          // update may replace it.
          baselineFallback ??= captureHeadBaselineSnapshot(element);
          markHeadElementManaged(element);
          retainedHydrationScript = true;
        }
      }

      if (!element) {
        removeConflictingScript(descriptor, unavailable());
        element = targetDocument.createElement(descriptor.tagName);
        applyDescriptorToElement(element, descriptor);
        targetDocument.head.appendChild(element);
      }

      claimed.add(element);
      nextRecords.push({
        descriptor,
        element,
        ...(baselineFallback && { baselineFallback }),
        ...(retainedHydrationScript && { retainedHydrationScript: true }),
      });
    }

    for (const record of records) {
      if (!claimed.has(record.element)) releaseHeadRecord(record, targetDocument);
    }

    // Mirror SSR grouping while preserving declaration order within a group.
    // Never move scripts: an adopted executable has already run.
    const orderRank: Readonly<Record<string, number>> = {
      title: 0,
      meta: 1,
      link: 2,
      style: 3,
    };
    const orderedRecords = nextRecords
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.descriptor.tagName !== "script")
      .sort((left, right) =>
        (orderRank[left.record.descriptor.tagName] ?? 4) -
          (orderRank[right.record.descriptor.tagName] ?? 4) ||
        left.index - right.index
      )
      .map(({ record }) => record);
    let previousElement: Element | undefined;
    for (const { element } of orderedRecords) {
      if (
        previousElement &&
        previousElement.compareDocumentPosition(element) & 2
      ) {
        previousElement.after(element);
      }
      previousElement = element;
    }
    records = nextRecords;

    const activeAnchors = new Set(
      activeRegistrations
        .map((registration) => registration.anchor)
        .filter((anchor): anchor is Element => anchor?.isConnected === true),
    );
    const ownerMarkers = [
      ...targetDocument.querySelectorAll(
        `[${HEAD_REACT_OWNER_ATTRIBUTE}="1"]`,
      ),
    ];
    if (ownerMarkers.every((marker) => activeAnchors.has(marker))) {
      for (const element of initialSSRElements) {
        if (
          !claimed.has(element) &&
          element.parentElement === targetDocument.head
        ) {
          element.remove();
        }
      }
      initialSSRElements.clear();
    }

    for (const [owner, registration] of registrations) {
      if (!registration.active) registrations.delete(owner);
    }
  }

  function scheduleReconciliation(): void {
    if (reconciliationScheduled) return;
    reconciliationScheduled = true;
    queueMicrotask(() => {
      reconciliationScheduled = false;
      reconcile();
    });
  }

  return {
    update(owner, anchor, descriptors) {
      const existing = registrations.get(owner);
      if (existing) {
        existing.anchor = anchor;
        existing.descriptors = descriptors;
        existing.active = true;
      } else {
        registrations.set(owner, {
          anchor,
          descriptors,
          active: true,
          sequence: nextSequence++,
        });
      }
      scheduleReconciliation();
    },
    deactivate(owner) {
      const registration = registrations.get(owner);
      if (!registration) return;
      registration.active = false;
      scheduleReconciliation();
    },
    retire() {
      registrations.clear();
      // Retirement is a cross-page authority handoff, not an in-page overlay
      // release. Only app-wide state that route payloads cannot reconstruct is
      // restored or promoted; all page-specific baselines are discarded.
      for (const record of records) {
        if (
          isCrossPagePreservedSingleton(
            record.element,
            record.descriptor.singletonKey,
          )
        ) {
          if (record.baselineFallback) {
            restoreHeadBaselineSnapshot(record.element, record.baselineFallback);
          } else {
            promoteToShellHeadBaseline(record.element);
          }
        } else {
          record.element.remove();
        }
      }
      records = [];
      initialSSRElements.clear();
      for (const element of [...targetDocument.head.children]) {
        if (isFrameworkOwnedHeadElement(element)) retireFrameworkHeadElement(element);
      }
    },
  };
}

export function getClientHeadManager(
  targetDocument: Document,
): ClientHeadManager {
  const state = getClientHeadManagerState();
  let manager = state.documents.get(targetDocument);
  if (!manager) {
    manager = createClientHeadManager(targetDocument);
    state.documents.set(targetDocument, manager);
  }

  const globalRetirer = globalThis as typeof globalThis & {
    [HEAD_MANAGER_RETIRE_SYMBOL]?: (document: Document) => void;
  };
  globalRetirer[HEAD_MANAGER_RETIRE_SYMBOL] ??= retireClientHeadOwnership;
  return manager;
}

/** Explicitly hand document-head authority to a non-React route renderer. */
export function retireClientHeadOwnership(targetDocument: Document): void {
  const manager = getClientHeadManagerState().documents.get(targetDocument);
  if (manager) {
    manager.retire();
    return;
  }

  // A navigation can happen before the React runtime evaluates. SSR provenance
  // still belongs to the previous page and must not survive the handoff.
  for (const element of [...(targetDocument.head?.children ?? [])]) {
    if (isFrameworkOwnedHeadElement(element)) retireFrameworkHeadElement(element);
  }
}
