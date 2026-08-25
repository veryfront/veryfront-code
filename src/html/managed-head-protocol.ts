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
export const HEAD_ROUTE_MANAGED_ATTRIBUTE = "data-vf-route-head";
export const HEAD_SERVER_COMMIT_ATTRIBUTE = "data-vf-server-head-commit";
export const HEAD_SHELL_PROVENANCE_ATTRIBUTE = "data-vf-shell-head";
export const HEAD_SSR_PAYLOAD_ATTRIBUTE = "data-vf-ssr-head";
export const HEAD_MANAGER_RETIRE_SYMBOL = Symbol.for(
  "veryfront.client-head-manager.retire.v1",
);

/** Request-level limits shared by SSR collection and client route handoff. */
export const MAX_MANAGED_HEAD_ENTRIES = 128;
export const MAX_MANAGED_HEAD_BYTES = 2 * 1024 * 1024;
export const MAX_MANAGED_HEAD_PAYLOAD_BYTES = MAX_MANAGED_HEAD_BYTES * 2;

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

export interface ManagedHeadTransportEntry {
  readonly tagName: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly content?: string;
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

const HEAD_ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const MAX_HEAD_PROP_ENTRIES = 128;
const MAX_HEAD_ATTRIBUTE_NAME_BYTES = 256;
const MAX_HEAD_ATTRIBUTE_VALUE_BYTES = 64 * 1024;
const MAX_HEAD_ATTRIBUTE_BYTES = 1024 * 1024;
const MAX_HEAD_CONTENT_BYTES = 1024 * 1024;
const MAX_HEAD_CHILD_VALUES = 4096;
const MAX_HEAD_CHILD_DEPTH = 64;
const headTextEncoder = new TextEncoder();

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
    case HEAD_ROUTE_MANAGED_ATTRIBUTE:
    case HEAD_SERVER_COMMIT_ATTRIBUTE:
    case HEAD_SHELL_PROVENANCE_ATTRIBUTE:
    case HEAD_SSR_PAYLOAD_ATTRIBUTE:
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

function readOwnString(
  record: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
    return descriptor && !descriptor.get && !descriptor.set && "value" in descriptor &&
        typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function headMetaSingletonKeyFromRecord(
  meta: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (readOwnString(meta, "charset") !== undefined) return "meta:charset";

  const key = normalizeHeadIdentityValue(
    readOwnString(meta, "property") ?? readOwnString(meta, "name"),
  );
  if (!key) return undefined;
  if (key === "theme-color") {
    return `meta:theme-color:${readOwnString(meta, "media")?.trim() ?? ""}`;
  }
  return SINGLETON_META_KEYS.has(key) ? `meta:${key}` : undefined;
}

export function headLinkSingletonKeyFromRecord(
  link: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const rel = normalizeHeadIdentityValue(readOwnString(link, "rel"));
  return rel && SINGLETON_LINK_RELS.has(rel) ? `link:${rel}` : undefined;
}

export function normalizeManagedHeadString(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

type InspectedHeadProps = ReadonlyMap<string, unknown>;

function inspectHeadProps(value: unknown): InspectedHeadProps | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;

  const inspected = new Map<string, unknown>();
  let entries = 0;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor) return null;
    if (!descriptor.enumerable) continue;
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      return null;
    }
    entries++;
    if (entries > MAX_HEAD_PROP_ENTRIES) return null;
    inspected.set(key, descriptor.value);
  }
  return inspected;
}

function normalizeContentPrimitive(value: unknown): string | undefined | null {
  if (value === null || value === undefined || typeof value === "boolean") return undefined;
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }
  const content = normalizeManagedHeadString(String(value));
  return headTextEncoder.encode(content).byteLength <= MAX_HEAD_CONTENT_BYTES ? content : null;
}

interface HeadChildrenInspectionState {
  nodes: number;
  bytes: number;
  readonly parts: string[];
  readonly arrays: WeakSet<object>;
}

function appendHeadChildren(
  value: unknown,
  state: HeadChildrenInspectionState,
  depth: number,
): boolean {
  state.nodes++;
  if (state.nodes > MAX_HEAD_CHILD_VALUES || depth > MAX_HEAD_CHILD_DEPTH) return false;

  const primitive = normalizeContentPrimitive(value);
  if (primitive === null) {
    if (!Array.isArray(value)) return true;
  } else if (primitive !== undefined) {
    const bytes = headTextEncoder.encode(primitive).byteLength;
    if (state.bytes + bytes > MAX_HEAD_CONTENT_BYTES) return false;
    state.bytes += bytes;
    state.parts.push(primitive);
    return true;
  } else {
    return true;
  }

  const array = value as unknown[];
  if (state.arrays.has(array)) return false;
  state.arrays.add(array);

  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Reflect.getOwnPropertyDescriptor(array, "length");
  } catch {
    state.arrays.delete(array);
    return false;
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_HEAD_CHILD_VALUES
  ) {
    state.arrays.delete(array);
    return false;
  }

  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(array, String(index));
    } catch {
      state.arrays.delete(array);
      return false;
    }
    if (!descriptor || !descriptor.enumerable) continue;
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      state.arrays.delete(array);
      return false;
    }
    if (!appendHeadChildren(descriptor.value, state, depth + 1)) {
      state.arrays.delete(array);
      return false;
    }
  }
  state.arrays.delete(array);
  return true;
}

function textFromHeadChildren(value: unknown): string | undefined | null {
  const state: HeadChildrenInspectionState = {
    nodes: 0,
    bytes: 0,
    parts: [],
    arrays: new WeakSet<object>(),
  };
  if (!appendHeadChildren(value, state, 0)) return null;
  return state.parts.length > 0 || Array.isArray(value) ? state.parts.join("") : undefined;
}

function readManagedHeadContentFromProps(
  props: InspectedHeadProps,
): { content?: string; isRawHTML: boolean } | null {
  const rawHTML = props.get("dangerouslySetInnerHTML");
  if (rawHTML !== null && rawHTML !== undefined) {
    const rawRecord = inspectHeadProps(rawHTML);
    if (!rawRecord) return null;
    const rawContent = normalizeContentPrimitive(rawRecord.get("__html"));
    if (rawContent === null) return null;
    if (rawContent !== undefined) return { content: rawContent, isRawHTML: true };
  }

  const content = textFromHeadChildren(props.get("children"));
  if (content === null) return null;
  return content === undefined ? { isRawHTML: false } : { content, isRawHTML: false };
}

export function readManagedHeadContent(
  props: Readonly<Record<string, unknown>>,
): { content?: string; isRawHTML: boolean } | null {
  const inspected = inspectHeadProps(props);
  return inspected ? readManagedHeadContentFromProps(inspected) : null;
}

function normalizeManagedHeadAttributesFromProps(
  tagName: string,
  props: InspectedHeadProps,
  ambientNonce?: string,
  excludedKeys: ReadonlySet<string> = new Set(),
): readonly ManagedHeadAttribute[] | null {
  const attributeMap = new Map<string, string>();
  for (const [key, value] of props) {
    if (
      key === "children" || key === "dangerouslySetInnerHTML" ||
      excludedKeys.has(key)
    ) {
      continue;
    }
    if (
      /^on/i.test(key) ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "object"
    ) {
      continue;
    }

    const name = (REACT_HEAD_ATTRIBUTE_NAMES[key] ?? key).toLowerCase();
    if (
      isHeadFrameworkAttribute(name) ||
      !HEAD_ATTRIBUTE_NAME_PATTERN.test(name) ||
      headTextEncoder.encode(name).byteLength > MAX_HEAD_ATTRIBUTE_NAME_BYTES
    ) {
      continue;
    }

    if (BOOLEAN_HEAD_ATTRIBUTES.has(name)) {
      if (value !== false && value !== undefined) attributeMap.set(name, "");
      continue;
    }
    if (typeof value === "boolean") {
      if (name.startsWith("data-") || name.startsWith("aria-")) {
        attributeMap.set(name, String(value));
      }
      continue;
    }
    if (value === undefined) continue;
    if (
      typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "bigint"
    ) {
      continue;
    }

    const normalizedValue = normalizeManagedHeadString(String(value));
    if (headTextEncoder.encode(normalizedValue).byteLength > MAX_HEAD_ATTRIBUTE_VALUE_BYTES) {
      return null;
    }
    attributeMap.set(name, normalizedValue);
  }

  if (tagName === "script" || tagName === "style") {
    // A source-authored nonce is never a response credential. The framework
    // binds its ambient nonce only to inline executable/style content. In
    // particular, external scripts must satisfy CSP's source allowlist.
    attributeMap.delete("nonce");
  }
  const acceptsAmbientNonce = tagName === "style" ||
    (tagName === "script" && !attributeMap.has("src"));
  if (acceptsAmbientNonce && ambientNonce) {
    const nonce = normalizeManagedHeadString(ambientNonce);
    if (headTextEncoder.encode(nonce).byteLength > MAX_HEAD_ATTRIBUTE_VALUE_BYTES) return null;
    attributeMap.set("nonce", nonce);
  }
  if (
    tagName === "link" &&
    attributeMap.get("rel")?.trim().toLowerCase() === "preload" &&
    attributeMap.get("as")?.trim().toLowerCase() === "font" &&
    !attributeMap.has("crossorigin")
  ) {
    attributeMap.set("crossorigin", "anonymous");
  }

  if (attributeMap.size > MAX_HEAD_PROP_ENTRIES) return null;
  let totalBytes = 0;
  for (const [name, value] of attributeMap) {
    totalBytes += headTextEncoder.encode(name).byteLength +
      headTextEncoder.encode(value).byteLength;
    if (totalBytes > MAX_HEAD_ATTRIBUTE_BYTES) return null;
  }

  return [...attributeMap.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function normalizeManagedHeadAttributes(
  tagName: string,
  props: Readonly<Record<string, unknown>>,
  ambientNonce?: string,
): readonly ManagedHeadAttribute[] | null {
  const inspected = inspectHeadProps(props);
  return inspected
    ? normalizeManagedHeadAttributesFromProps(tagName, inspected, ambientNonce)
    : null;
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

function declaresDocumentEncoding(attributes: ReadonlyMap<string, string>): boolean {
  return attributes.has("charset") ||
    attributes.get("http-equiv")?.trim().toLowerCase() === "content-type";
}

function createManagedHeadDescriptor(
  tagName: string,
  attributes: readonly ManagedHeadAttribute[],
  content: string | undefined,
  contentMode: ManagedHeadContentMode,
): ManagedHeadDescriptor {
  const attributeMap = new Map(attributes);
  return {
    tagName,
    attributes,
    ...(content !== undefined && { content }),
    contentMode,
    signature: JSON.stringify([
      tagName,
      attributes,
      contentMode,
      content ?? null,
    ]),
    singletonKey: singletonKey(tagName, attributeMap),
    scriptKeys: scriptKeys(tagName, attributeMap),
  };
}

export function descriptorFromHeadProps(
  rawTagName: string,
  props: Readonly<Record<string, unknown>>,
  ambientNonce?: string,
): ManagedHeadDescriptor | null {
  const tagName = rawTagName.toLowerCase();
  if (!SUPPORTED_MANAGED_HEAD_TAGS.has(tagName)) return null;

  const inspected = inspectHeadProps(props);
  if (!inspected) return null;
  const normalizedContent = readManagedHeadContentFromProps(inspected);
  if (!normalizedContent) return null;

  if (tagName === "title") {
    return createManagedHeadDescriptor(
      tagName,
      [],
      normalizedContent.content ?? "",
      "text",
    );
  }

  const attributes = normalizeManagedHeadAttributesFromProps(
    tagName,
    inspected,
    ambientNonce,
  );
  if (!attributes) return null;
  const attributeMap = new Map(attributes);
  // The HTML shell is the single authority for the document encoding. It
  // always emits UTF-8 early in <head>; allowing a component-level charset
  // would create a second declaration and ambiguous client ownership.
  if (tagName === "meta" && declaresDocumentEncoding(attributeMap)) return null;
  if (
    (tagName === "meta" || tagName === "link") &&
    attributes.length === 0
  ) {
    return null;
  }
  const hasContent = tagName !== "meta" && tagName !== "link";
  const contentMode = hasContent && normalizedContent.isRawHTML &&
      tagName !== "script" &&
      tagName !== "style"
    ? "html"
    : "text";

  return createManagedHeadDescriptor(
    tagName,
    attributes,
    hasContent ? normalizedContent.content : undefined,
    contentMode,
  );
}

/**
 * Normalizes a collector/frontmatter head record through the same bounded
 * protocol used for React props. `contentProperty` identifies inline
 * script/style text and is never emitted as an HTML attribute.
 */
export function descriptorFromManagedHeadRecord(
  rawTagName: string,
  record: Readonly<Record<string, unknown>>,
  options: {
    readonly contentProperty?: string;
    readonly ambientNonce?: string;
  } = {},
): ManagedHeadDescriptor | null {
  const tagName = rawTagName.toLowerCase();
  if (!SUPPORTED_MANAGED_HEAD_TAGS.has(tagName)) return null;

  const inspected = inspectHeadProps(record);
  if (!inspected) return null;
  const excludedKeys = options.contentProperty
    ? new Set([options.contentProperty])
    : new Set<string>();
  const attributes = normalizeManagedHeadAttributesFromProps(
    tagName,
    inspected,
    options.ambientNonce,
    excludedKeys,
  );
  if (!attributes) return null;
  const attributeMap = new Map(attributes);
  if (tagName === "meta" && declaresDocumentEncoding(attributeMap)) return null;
  if ((tagName === "meta" || tagName === "link") && attributes.length === 0) return null;

  let content: string | undefined;
  if (options.contentProperty) {
    const normalized = normalizeContentPrimitive(inspected.get(options.contentProperty));
    if (normalized === null) return null;
    content = normalized;
  }
  return createManagedHeadDescriptor(tagName, attributes, content, "text");
}

export function scriptIdentityKeysFromRecord(
  script: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const keys: string[] = [];
  const id = readOwnString(script, "id");
  const src = readOwnString(script, "src");
  if (id) keys.push(`script:id:${id}`);
  if (src) keys.push(`script:src:${src}`);
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

export function managedHeadDescriptorBytes(descriptor: ManagedHeadDescriptor): number {
  let bytes = headTextEncoder.encode(descriptor.tagName).byteLength;
  for (const [name, value] of descriptor.attributes) {
    bytes += headTextEncoder.encode(name).byteLength;
    bytes += headTextEncoder.encode(value).byteLength;
  }
  if (descriptor.content !== undefined) {
    bytes += headTextEncoder.encode(descriptor.content).byteLength;
  }
  return bytes;
}

export function assertManagedHeadDescriptorBudget(
  descriptors: readonly ManagedHeadDescriptor[],
): void {
  if (descriptors.length > MAX_MANAGED_HEAD_ENTRIES) {
    throw new TypeError(
      `Managed head exceeds the ${MAX_MANAGED_HEAD_ENTRIES}-entry request limit`,
    );
  }

  let bytes = 0;
  for (const descriptor of descriptors) {
    bytes += managedHeadDescriptorBytes(descriptor);
    if (bytes > MAX_MANAGED_HEAD_BYTES) {
      throw new TypeError(
        `Managed head exceeds the ${MAX_MANAGED_HEAD_BYTES}-byte request limit`,
      );
    }
  }
}

export function managedHeadDescriptorToTransportEntry(
  descriptor: ManagedHeadDescriptor,
): ManagedHeadTransportEntry {
  const attributes = descriptor.attributes.filter(([name]) => name !== "nonce");
  return {
    tagName: descriptor.tagName,
    attributes: attributes.map(([name, value]) => [name, value] as const),
    ...(descriptor.content !== undefined && { content: descriptor.content }),
  };
}

function ownTransportValue(record: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(record, key);
  } catch {
    return undefined;
  }
  if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
    return undefined;
  }
  return descriptor.value;
}

export function descriptorFromManagedHeadTransportEntry(
  entry: unknown,
  ambientNonce?: string,
): ManagedHeadDescriptor {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new TypeError("Managed-head transport entries must be plain objects");
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(entry);
  } catch {
    throw new TypeError("Managed-head transport entry cannot be inspected");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Managed-head transport entries must be plain objects");
  }

  const tagName = ownTransportValue(entry, "tagName");
  const rawAttributes = ownTransportValue(entry, "attributes");
  const content = ownTransportValue(entry, "content");
  if (
    typeof tagName !== "string" || tagName !== tagName.toLowerCase() ||
    !Array.isArray(rawAttributes)
  ) {
    throw new TypeError("Managed-head transport entry is not canonical");
  }
  if (rawAttributes.length > MAX_HEAD_PROP_ENTRIES) {
    throw new TypeError("Managed-head transport entry exceeds the attribute limit");
  }
  if (content !== undefined && typeof content !== "string") {
    throw new TypeError("Managed-head transport content must be a string");
  }

  const supportsText = tagName === "title" || tagName === "script" || tagName === "style";
  if (!supportsText && content !== undefined) {
    throw new TypeError("Managed-head transport content is invalid for this tag");
  }

  const record = Object.create(null) as Record<string, unknown>;
  const inputAttributes: ManagedHeadAttribute[] = [];
  const names = new Set<string>();
  for (let index = 0; index < rawAttributes.length; index += 1) {
    const pair = ownTransportValue(rawAttributes, String(index));
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError("Managed-head transport attributes must be string pairs");
    }
    const name = ownTransportValue(pair, "0");
    const value = ownTransportValue(pair, "1");
    if (typeof name !== "string" || typeof value !== "string") {
      throw new TypeError("Managed-head transport attributes must be string pairs");
    }
    const normalizedName = name.toLowerCase();
    if (name !== normalizedName || normalizedName === "nonce" || names.has(normalizedName)) {
      throw new TypeError("Managed-head transport attributes are not canonical");
    }
    names.add(normalizedName);
    inputAttributes.push([normalizedName, value]);
    Object.defineProperty(record, normalizedName, {
      enumerable: true,
      value,
    });
  }

  if (content !== undefined) {
    Object.defineProperty(record, "__veryfront_transport_content", {
      enumerable: true,
      value: content,
    });
  }

  const descriptor = descriptorFromManagedHeadRecord(tagName, record, {
    ...(supportsText && { contentProperty: "__veryfront_transport_content" }),
    ...((tagName === "script" || tagName === "style") && ambientNonce ? { ambientNonce } : {}),
  });
  const normalizedInput = inputAttributes.sort(([left], [right]) => left.localeCompare(right));
  const normalizedOutput = descriptor?.attributes.filter(([name]) => name !== "nonce");
  if (
    !descriptor ||
    JSON.stringify(normalizedOutput) !== JSON.stringify(normalizedInput) ||
    (supportsText && (descriptor.content ?? "") !== (content ?? ""))
  ) {
    throw new TypeError("Managed-head transport entry failed validation");
  }
  return descriptor;
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64URL_ALPHABET[first >> 2];
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) output += BASE64URL_ALPHABET[third & 0x3f];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  if (value.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError("Managed-head payload is not valid base64url");
  }
  const estimatedBytes = Math.floor(value.length * 3 / 4);
  if (estimatedBytes > MAX_MANAGED_HEAD_PAYLOAD_BYTES) {
    throw new TypeError("Managed-head payload exceeds its encoded size limit");
  }

  const bytes = new Uint8Array(estimatedBytes);
  let outputIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const decoded = BASE64URL_ALPHABET.indexOf(character);
    if (decoded < 0) throw new TypeError("Managed-head payload is not valid base64url");
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[outputIndex++] = (buffer >> bits) & 0xff;
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) {
    throw new TypeError("Managed-head payload has non-canonical trailing bits");
  }
  return bytes.subarray(0, outputIndex);
}

export function serializeManagedHeadPayload(
  descriptors: readonly ManagedHeadDescriptor[],
): string {
  assertManagedHeadDescriptorBudget(descriptors);
  const aggregated = aggregateManagedHeadDescriptors(descriptors);
  const entries = aggregated.map(managedHeadDescriptorToTransportEntry);
  return encodeBase64Url(headTextEncoder.encode(JSON.stringify(entries)));
}

export interface ManagedHeadPayloadInspection {
  readonly descriptors: ManagedHeadDescriptor[];
  readonly entryCount: number;
  readonly descriptorBytes: number;
  readonly payloadBytes: number;
}

export function inspectManagedHeadPayload(
  payload: string,
  ambientNonce?: string,
): ManagedHeadPayloadInspection {
  if (typeof payload !== "string") throw new TypeError("Managed-head payload must be a string");
  const payloadBytes = headTextEncoder.encode(payload).byteLength;
  if (payloadBytes > MAX_MANAGED_HEAD_PAYLOAD_BYTES) {
    throw new TypeError("Managed-head payload exceeds its encoded size limit");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(payload));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Managed-head payload is not valid UTF-8", { cause: error });
  }

  let entries: unknown;
  try {
    entries = JSON.parse(decoded);
  } catch (error) {
    throw new TypeError("Managed-head payload is not valid JSON", { cause: error });
  }
  if (!Array.isArray(entries) || entries.length > MAX_MANAGED_HEAD_ENTRIES) {
    throw new TypeError("Managed-head payload exceeds the entry limit");
  }
  const rawDescriptors = entries.map((entry) =>
    descriptorFromManagedHeadTransportEntry(entry, ambientNonce)
  );
  assertManagedHeadDescriptorBudget(rawDescriptors);
  return {
    descriptors: aggregateManagedHeadDescriptors(rawDescriptors),
    entryCount: rawDescriptors.length,
    descriptorBytes: rawDescriptors.reduce(
      (total, descriptor) => total + managedHeadDescriptorBytes(descriptor),
      0,
    ),
    payloadBytes,
  };
}

export function deserializeManagedHeadPayload(
  payload: string,
  ambientNonce?: string,
): ManagedHeadDescriptor[] {
  return inspectManagedHeadPayload(payload, ambientNonce).descriptors;
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
