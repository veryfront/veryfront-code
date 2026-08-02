import { retireClientHeadOwnership } from "./client-head-manager.ts";
import {
  aggregateManagedHeadDescriptors,
  descriptorFromManagedHeadRecord,
  HEAD_LEGACY_MANAGED_ATTRIBUTE,
  HEAD_ROUTE_MANAGED_ATTRIBUTE,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  headScriptKeysIntersect,
  isHeadFrameworkAttribute,
  type ManagedHeadDescriptor,
} from "./managed-head-protocol.ts";

const MAX_ROUTE_HEAD_ENTRIES = 100;
const MAX_ROUTE_HEAD_ATTRIBUTES = 128;
const ROUTE_HEAD_CONTENT_PROPERTY = "__veryfront_route_head_content";

export interface ClientRouteHeadEntry {
  readonly tagName: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly content?: string;
}

export interface ClientRouteHeadMetadata {
  readonly title?: unknown;
  readonly description?: unknown;
  readonly ogTitle?: unknown;
}

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
  if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
    return undefined;
  }
  return descriptor.value;
}

function descriptorFromRouteEntry(entry: unknown): ManagedHeadDescriptor {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new TypeError("Route head entries must be plain objects");
  }
  const prototype = Object.getPrototypeOf(entry);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Route head entries must be plain objects");
  }

  const tagName = ownDataValue(entry, "tagName");
  const rawAttributes = ownDataValue(entry, "attributes");
  const content = ownDataValue(entry, "content");
  if (typeof tagName !== "string" || !Array.isArray(rawAttributes)) {
    throw new TypeError("Route head entries require a tag name and attributes");
  }
  if (rawAttributes.length > MAX_ROUTE_HEAD_ATTRIBUTES) {
    throw new TypeError("Route head entry exceeds the attribute limit");
  }
  if (content !== undefined && typeof content !== "string") {
    throw new TypeError("Route head content must be a string");
  }

  const record = Object.create(null) as Record<string, unknown>;
  const inputAttributes: Array<readonly [string, string]> = [];
  const names = new Set<string>();
  for (let index = 0; index < rawAttributes.length; index += 1) {
    const pair = ownDataValue(rawAttributes, String(index));
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError("Route head attributes must be string pairs");
    }
    const name = ownDataValue(pair, "0");
    const value = ownDataValue(pair, "1");
    if (typeof name !== "string" || typeof value !== "string") {
      throw new TypeError("Route head attributes must be string pairs");
    }
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) {
      throw new TypeError("Route head attributes must be unique");
    }
    names.add(normalizedName);
    inputAttributes.push([normalizedName, value]);
    Object.defineProperty(record, normalizedName, {
      enumerable: true,
      value,
    });
  }
  if (content !== undefined) {
    Object.defineProperty(record, ROUTE_HEAD_CONTENT_PROPERTY, {
      enumerable: true,
      value: content,
    });
  }

  const supportsText = tagName === "title" || tagName === "script" || tagName === "style";
  const descriptor = descriptorFromManagedHeadRecord(
    tagName,
    record,
    supportsText ? { contentProperty: ROUTE_HEAD_CONTENT_PROPERTY } : undefined,
  );
  const sortedInput = inputAttributes.sort(([left], [right]) => left.localeCompare(right));
  if (
    !descriptor ||
    JSON.stringify(descriptor.attributes) !== JSON.stringify(sortedInput) ||
    (supportsText && (descriptor.content ?? "") !== (content ?? ""))
  ) {
    throw new TypeError("Route head entry failed managed-head validation");
  }
  return descriptor;
}

function descriptorFromHeadElement(element: Element): ManagedHeadDescriptor | null {
  const record = Object.create(null) as Record<string, unknown>;
  for (const { name, value } of element.attributes) {
    if (!isHeadFrameworkAttribute(name)) record[name] = value;
  }
  const tagName = element.tagName.toLowerCase();
  const supportsText = tagName === "title" || tagName === "script" || tagName === "style";
  if (supportsText) record[ROUTE_HEAD_CONTENT_PROPERTY] = element.textContent ?? "";
  return descriptorFromManagedHeadRecord(
    tagName,
    record,
    supportsText ? { contentProperty: ROUTE_HEAD_CONTENT_PROPERTY } : undefined,
  );
}

function writeRouteDescriptor(element: Element, descriptor: ManagedHeadDescriptor): void {
  for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
  for (const [name, value] of descriptor.attributes) element.setAttribute(name, value);
  element.textContent = descriptor.content ?? "";
  element.setAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE, "1");
  element.setAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE, "true");
}

export function applyClientRouteHeadEntries(
  entries: unknown,
  targetDocument: Document = document,
): void {
  if (entries === undefined) return;
  if (!Array.isArray(entries) || entries.length > MAX_ROUTE_HEAD_ENTRIES) {
    throw new TypeError("Route head payload exceeds the entry limit");
  }

  // Validate the complete payload before mutating the live document.
  const descriptors = aggregateManagedHeadDescriptors(
    entries.map(descriptorFromRouteEntry),
  );
  for (const descriptor of descriptors) {
    const ownedElements = [...targetDocument.head.children].filter((element) =>
      element.getAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE) === "1" ||
      element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true" ||
      element.getAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE) === "true"
    );
    const described = ownedElements.flatMap((element) => {
      const current = descriptorFromHeadElement(element);
      return current ? [{ element, descriptor: current }] : [];
    });

    if (descriptor.singletonKey) {
      const existing = described.find(({ descriptor: current }) =>
        current.singletonKey === descriptor.singletonKey
      );
      if (existing) {
        // Destination body directives are authoritative. Preserved shell state
        // is framework-owned and may be updated in place for the new route.
        if (existing.element.getAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE) === "1") continue;
        writeRouteDescriptor(existing.element, descriptor);
        continue;
      }
    }
    if (
      described.some(({ descriptor: current }) =>
        current.signature === descriptor.signature ||
        headScriptKeysIntersect(current.scriptKeys, descriptor.scriptKeys)
      )
    ) {
      continue;
    }

    const element = targetDocument.createElement(descriptor.tagName);
    writeRouteDescriptor(element, descriptor);
    targetDocument.head.appendChild(element);
  }
}

export function updateRouteTitle(
  title: unknown,
  targetDocument: Document = document,
): void {
  if (typeof title !== "string" || !title) return;

  const titles = [...targetDocument.head.querySelectorAll("title")];
  if (
    titles.some((element) => element.getAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE) === "1")
  ) {
    return;
  }

  let titleElement = titles.find((element) =>
    element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true"
  );
  if (!titleElement) {
    titleElement = targetDocument.createElement("title");
    titleElement.setAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE, "true");
    targetDocument.head.appendChild(titleElement);
  }
  titleElement.textContent = title;
}

function updateRouteMetaTag(
  targetDocument: Document,
  selector: string,
  attributeName: string,
  attributeValue: string,
  content: string,
): void {
  const matches = [...targetDocument.head.querySelectorAll(selector)];
  if (
    matches.some((element) => element.getAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE) === "1")
  ) {
    return;
  }

  let metaTag = matches.find((element) =>
    element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true"
  );
  if (!metaTag) {
    metaTag = targetDocument.createElement("meta");
    metaTag.setAttribute(attributeName, attributeValue);
    metaTag.setAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE, "true");
    targetDocument.head.appendChild(metaTag);
  }

  metaTag.setAttribute("content", content);
}

export function updateRouteMetaTags(
  metadata: ClientRouteHeadMetadata,
  targetDocument: Document = document,
): void {
  if (typeof metadata.description === "string" && metadata.description) {
    updateRouteMetaTag(
      targetDocument,
      'meta[name="description"]',
      "name",
      "description",
      metadata.description,
    );
  }

  if (typeof metadata.ogTitle === "string" && metadata.ogTitle) {
    updateRouteMetaTag(
      targetDocument,
      'meta[property="og:title"]',
      "property",
      "og:title",
      metadata.ogTitle,
    );
  }
}

export function handoffClientRouteMetadata(
  metadata: ClientRouteHeadMetadata,
  targetDocument: Document = document,
): void {
  retireClientHeadOwnership(targetDocument);
  updateRouteTitle(metadata.title, targetDocument);
  updateRouteMetaTags(metadata, targetDocument);
}
