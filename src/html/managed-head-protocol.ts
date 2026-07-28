/**
 * Shared, dependency-free protocol for server- and client-managed document
 * head elements. Keeping normalization and identity here prevents hydration
 * from making different decisions than the SSR collector.
 */

export const HEAD_PROVENANCE_ATTRIBUTE = "data-vf-head";
export const HEAD_LEGACY_MANAGED_ATTRIBUTE = "data-veryfront-managed";
export const HEAD_CONTENT_HASH_ATTRIBUTE = "data-vf-hash";
export const HEAD_REACT_MANAGED_ATTRIBUTE = "data-vf-react-head";
export const HEAD_REACT_OWNER_ATTRIBUTE = "data-vf-react-head-owner";
export const HEAD_MANAGER_RETIRE_SYMBOL = Symbol.for(
  "veryfront.client-head-manager.retire.v1",
);

export type ManagedHeadContentMode = "text" | "html";
export type ManagedHeadAttribute = readonly [name: string, value: string];

export interface ManagedHeadDescriptor {
  readonly tagName: string;
  readonly attributes: readonly ManagedHeadAttribute[];
  readonly content?: string;
  readonly contentMode: ManagedHeadContentMode;
  readonly signature: string;
  readonly singletonKey?: string;
  /**
   * Every stable identity alias for a script. Both `id` and `src` matter:
   * scripts intersecting on either alias represent the same executable slot.
   */
  readonly scriptKeys: readonly string[];
}

const REACT_HEAD_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  charSet: "charset",
  className: "class",
  crossOrigin: "crossorigin",
  fetchPriority: "fetchpriority",
  htmlFor: "for",
  httpEquiv: "http-equiv",
  imageSizes: "imagesizes",
  imageSrcSet: "imagesrcset",
  noModule: "nomodule",
  referrerPolicy: "referrerpolicy",
};

const SINGLETON_META_KEYS = new Set([
  "description",
  "robots",
  "viewport",
  "referrer",
  "color-scheme",
  "application-name",
  "generator",
  "og:title",
  "og:description",
  "og:url",
  "og:type",
  "og:site_name",
  "og:locale",
  "twitter:card",
  "twitter:site",
  "twitter:creator",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
]);

const SINGLETON_LINK_RELS = new Set([
  "canonical",
  "manifest",
  "amphtml",
]);
const SUPPORTED_MANAGED_HEAD_TAGS = new Set([
  "title",
  "meta",
  "link",
  "style",
  "script",
]);

export const BOOLEAN_HEAD_ATTRIBUTES = new Set([
  "async",
  "defer",
  "disabled",
  "itemscope",
  "nomodule",
]);

export function isHeadFrameworkAttribute(name: string): boolean {
  switch (name.toLowerCase()) {
    case HEAD_PROVENANCE_ATTRIBUTE:
    case HEAD_LEGACY_MANAGED_ATTRIBUTE:
    case HEAD_CONTENT_HASH_ATTRIBUTE:
    case HEAD_REACT_MANAGED_ATTRIBUTE:
    case HEAD_REACT_OWNER_ATTRIBUTE:
      return true;
    default:
      return false;
  }
}

export function isSingletonHeadMetaKey(key: string | undefined): boolean {
  const normalized = normalizeHeadIdentityValue(key);
  return normalized !== undefined && SINGLETON_META_KEYS.has(normalized);
}

export function isSingletonHeadLinkRel(rel: string | undefined): boolean {
  const normalized = normalizeHeadIdentityValue(rel);
  return normalized !== undefined && SINGLETON_LINK_RELS.has(normalized);
}

function normalizeHeadIdentityValue(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function headMetaSingletonKeyFromRecord(
  meta: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (meta.charset !== undefined) return "meta:charset";

  const key = normalizeHeadIdentityValue(meta.property ?? meta.name);
  if (!key) return undefined;
  if (key === "theme-color") {
    return `meta:theme-color:${meta.media?.trim() ?? ""}`;
  }
  return SINGLETON_META_KEYS.has(key) ? `meta:${key}` : undefined;
}

export function headLinkSingletonKeyFromRecord(
  link: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const rel = normalizeHeadIdentityValue(link.rel);
  return rel && SINGLETON_LINK_RELS.has(rel) ? `link:${rel}` : undefined;
}

export function normalizeManagedHeadString(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function textFromHeadChildren(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeManagedHeadString(String(value));
  }
  if (!Array.isArray(value)) return undefined;

  let result = "";
  for (const child of value) {
    if (child === null || child === undefined || typeof child === "boolean") continue;
    const text = textFromHeadChildren(child);
    if (text !== undefined) result += text;
  }
  return result;
}

export function readManagedHeadContent(
  props: Readonly<Record<string, unknown>>,
): { content?: string; isRawHTML: boolean } {
  const rawHTML = props.dangerouslySetInnerHTML;
  if (rawHTML && typeof rawHTML === "object") {
    const descriptor = Reflect.getOwnPropertyDescriptor(rawHTML, "__html");
    if (
      descriptor && "value" in descriptor &&
      descriptor.value !== undefined &&
      descriptor.value !== null
    ) {
      return {
        content: normalizeManagedHeadString(String(descriptor.value)),
        isRawHTML: true,
      };
    }
  }

  const content = textFromHeadChildren(props.children);
  return content === undefined ? { isRawHTML: false } : { content, isRawHTML: false };
}

export function normalizeManagedHeadAttributes(
  tagName: string,
  props: Readonly<Record<string, unknown>>,
  ambientNonce?: string,
): readonly ManagedHeadAttribute[] {
  const attributeMap = new Map<string, string>();
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "dangerouslySetInnerHTML") continue;
    if (
      /^on/i.test(key) ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "object"
    ) {
      continue;
    }

    const name = (REACT_HEAD_ATTRIBUTE_NAMES[key] ?? key).toLowerCase();
    if (isHeadFrameworkAttribute(name)) continue;

    if (BOOLEAN_HEAD_ATTRIBUTES.has(name)) {
      if (value !== false && value !== null && value !== undefined) {
        attributeMap.set(name, "");
      }
      continue;
    }
    if (typeof value === "boolean") {
      attributeMap.set(name, String(value));
      continue;
    }
    if (value !== null && value !== undefined) {
      attributeMap.set(
        name,
        normalizeManagedHeadString(String(value)),
      );
    }
  }

  if (
    (tagName === "script" || tagName === "style") &&
    ambientNonce
  ) {
    // The response CSP nonce is authoritative. SSR nonce injection rewrites
    // authored values, so the client descriptor must make the same decision
    // or hydration would restore a stale nonce onto an adopted node.
    attributeMap.set("nonce", ambientNonce);
  }
  if (
    tagName === "link" &&
    attributeMap.get("rel")?.trim().toLowerCase() === "preload" &&
    attributeMap.get("as")?.trim().toLowerCase() === "font" &&
    !attributeMap.has("crossorigin")
  ) {
    attributeMap.set("crossorigin", "anonymous");
  }

  return [...attributeMap.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function singletonKey(
  tagName: string,
  attributes: ReadonlyMap<string, string>,
): string | undefined {
  if (tagName === "title") return "title";
  const record = Object.fromEntries(attributes);
  if (tagName === "meta") return headMetaSingletonKeyFromRecord(record);
  if (tagName === "link") return headLinkSingletonKeyFromRecord(record);
  return undefined;
}

function scriptKeys(
  tagName: string,
  attributes: ReadonlyMap<string, string>,
): readonly string[] {
  if (tagName !== "script") return [];
  const keys: string[] = [];
  const id = attributes.get("id");
  const src = attributes.get("src");
  if (id) keys.push(`script:id:${id}`);
  if (src) keys.push(`script:src:${src}`);
  return keys;
}

export function descriptorFromHeadProps(
  rawTagName: string,
  props: Readonly<Record<string, unknown>>,
  ambientNonce?: string,
): ManagedHeadDescriptor | null {
  const tagName = rawTagName.toLowerCase();
  if (!SUPPORTED_MANAGED_HEAD_TAGS.has(tagName)) return null;

  if (tagName === "title") {
    const content = readManagedHeadContent(props).content ?? "";
    return {
      tagName,
      attributes: [],
      content,
      contentMode: "text",
      signature: JSON.stringify([tagName, [], "text", content]),
      singletonKey: "title",
      scriptKeys: [],
    };
  }

  const attributes = normalizeManagedHeadAttributes(tagName, props, ambientNonce);
  const attributeMap = new Map(attributes);
  // The HTML shell is the single authority for the document encoding. It
  // always emits UTF-8 early in <head>; allowing a component-level charset
  // would create a second declaration and ambiguous client ownership.
  if (tagName === "meta" && attributeMap.has("charset")) return null;
  if (
    (tagName === "meta" || tagName === "link") &&
    attributes.length === 0
  ) {
    return null;
  }
  const hasContent = tagName !== "meta" && tagName !== "link";
  const normalizedContent = hasContent ? readManagedHeadContent(props) : { isRawHTML: false };
  const contentMode = normalizedContent.isRawHTML &&
      tagName !== "script" &&
      tagName !== "style"
    ? "html"
    : "text";

  return {
    tagName,
    attributes,
    ...(normalizedContent.content !== undefined && { content: normalizedContent.content }),
    contentMode,
    signature: JSON.stringify([
      tagName,
      attributes,
      contentMode,
      normalizedContent.content ?? null,
    ]),
    singletonKey: singletonKey(tagName, attributeMap),
    scriptKeys: scriptKeys(tagName, attributeMap),
  };
}

export function scriptIdentityKeysFromRecord(
  script: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const keys: string[] = [];
  if (script.id) keys.push(`script:id:${script.id}`);
  if (script.src) keys.push(`script:src:${script.src}`);
  return keys;
}

export function headScriptKeysIntersect(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightKeys = new Set(right);
  return left.some((key) => rightKeys.has(key));
}

/**
 * Page/layout aggregation contract shared with the SSR collector.
 * Singletons are last-wins in the first slot, repeatables preserve order, and
 * executable scripts are first-wins when any stable identity alias intersects.
 */
export function aggregateManagedHeadDescriptors(
  descriptors: readonly ManagedHeadDescriptor[],
): ManagedHeadDescriptor[] {
  const aggregated: ManagedHeadDescriptor[] = [];
  const singletonIndexes = new Map<string, number>();
  const scriptKeysSeen = new Set<string>();

  for (const descriptor of descriptors) {
    if (descriptor.singletonKey) {
      const index = singletonIndexes.get(descriptor.singletonKey);
      if (index !== undefined) {
        aggregated[index] = descriptor;
        continue;
      }
      singletonIndexes.set(descriptor.singletonKey, aggregated.length);
    } else if (descriptor.scriptKeys.length > 0) {
      if (descriptor.scriptKeys.some((key) => scriptKeysSeen.has(key))) continue;
      for (const key of descriptor.scriptKeys) scriptKeysSeen.add(key);
    }
    aggregated.push(descriptor);
  }

  return aggregated;
}

export function escapeManagedHeadRawText(content: string, tagName: string): string {
  if (tagName === "script") {
    return content.replace(
      /<\/script/gi,
      (match) => `<\\/${match.slice(2)}`,
    );
  }
  if (tagName === "style") {
    return content.replace(
      /<\/style/gi,
      (match) => `<\\/${match.slice(2)}`,
    );
  }
  return content;
}

export function managedHeadContentHash(content: string): string {
  let sum = 0;
  for (let index = 0; index < Math.min(content.length, 200); index++) {
    sum = ((sum << 5) - sum + content.charCodeAt(index)) | 0;
  }
  return `vf${Math.abs(sum).toString(36)}`;
}
