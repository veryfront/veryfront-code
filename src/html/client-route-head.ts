import { getManagedHeadNonce, retireClientHeadOwnership } from "./client-head-manager.ts";
import {
  aggregateManagedHeadDescriptors,
  assertManagedHeadDescriptorBudget,
  descriptorFromManagedHeadRecord,
  descriptorFromManagedHeadTransportEntry,
  HEAD_LEGACY_MANAGED_ATTRIBUTE,
  HEAD_ROUTE_MANAGED_ATTRIBUTE,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  headScriptKeysIntersect,
  isHeadFrameworkAttribute,
  type ManagedHeadDescriptor,
  type ManagedHeadTransportEntry,
  MAX_MANAGED_HEAD_ENTRIES,
} from "./managed-head-protocol.ts";

const ROUTE_HEAD_CONTENT_PROPERTY = "__veryfront_route_head_content";

export type ClientRouteHeadEntry = ManagedHeadTransportEntry;

export interface ClientRouteHeadMetadata {
  readonly title?: unknown;
  readonly description?: unknown;
  readonly ogTitle?: unknown;
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
  applyPreparedClientRouteHeadDescriptors(
    prepareClientRouteHeadEntries(entries, targetDocument),
    targetDocument,
  );
}

export function prepareClientRouteHeadEntries(
  entries: unknown,
  targetDocument: Document = document,
): readonly ManagedHeadDescriptor[] {
  if (entries === undefined) return [];
  if (!Array.isArray(entries) || entries.length > MAX_MANAGED_HEAD_ENTRIES) {
    throw new TypeError("Route head payload exceeds the entry limit");
  }

  const descriptors = aggregateManagedHeadDescriptors(
    entries.map((entry) =>
      descriptorFromManagedHeadTransportEntry(entry, getManagedHeadNonce(targetDocument))
    ),
  );
  assertManagedHeadDescriptorBudget(descriptors);
  return descriptors;
}

export function applyPreparedClientRouteHeadDescriptors(
  descriptors: readonly ManagedHeadDescriptor[],
  targetDocument: Document = document,
): void {
  for (const descriptor of descriptors) {
    const described = [...targetDocument.head.children].flatMap((element) => {
      const current = descriptorFromHeadElement(element);
      return current ? [{ element, descriptor: current }] : [];
    });

    if (descriptor.singletonKey) {
      const matches = described.filter(({ descriptor: current }) =>
        current.singletonKey === descriptor.singletonKey
      );
      const directive = matches.find(({ element }) =>
        element.getAttribute(HEAD_LEGACY_MANAGED_ATTRIBUTE) === "1"
      );
      if (directive) {
        for (const match of matches) {
          if (match !== directive) match.element.remove();
        }
        continue;
      }
      const reusable = matches.find(({ element }) =>
        element.getAttribute(HEAD_ROUTE_MANAGED_ATTRIBUTE) === "true" ||
        element.getAttribute(HEAD_SHELL_PROVENANCE_ATTRIBUTE) === "true"
      );
      for (const match of matches) {
        if (match !== reusable) match.element.remove();
      }
      if (reusable) {
        writeRouteDescriptor(reusable.element, descriptor);
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
  for (const element of titles) {
    if (element !== titleElement) element.remove();
  }
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
  for (const element of matches) {
    if (element !== metaTag) element.remove();
  }
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
