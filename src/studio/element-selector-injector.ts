import {
  findHtmlAttribute,
  findHtmlRawTextClosingTagStart,
  findHtmlTagEnd,
  getClosingHtmlTagName,
  getHtmlAttributeInsertionIndex,
  getOpeningHtmlTagName,
  isSelfClosingHtmlTag,
} from "#veryfront/html/tag-scanner.ts";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const IGNORED_SUBTREE_ELEMENTS = new Set([
  "head",
  "noscript",
  "script",
  "style",
  "template",
]);

const IGNORED_ELEMENT_ONLY = new Set([
  "html",
  "link",
  "meta",
]);

const RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

const MAX_PREFIX_LENGTH = 64;
const MAX_SKIP_ELEMENTS = 128;
const MAX_TAG_NAME_LENGTH = 64;
const PREFIX_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/i;

interface InjectorOptions {
  /** Prefix for generated selectors */
  prefix?: string;
  /** Elements and their descendants to skip (in addition to defaults) */
  skipElements?: string[];
}

interface NormalizedInjectorOptions {
  prefix: string;
  skipElements: Set<string>;
}

interface HtmlTagToken {
  start: number;
  end: number;
  source: string;
  tagName: string;
  closing: boolean;
  selfClosing: boolean;
}

function normalizePrefix(value: unknown): string {
  if (value === undefined) return "vf";
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_PREFIX_LENGTH ||
    !PREFIX_PATTERN.test(value)
  ) {
    throw new TypeError(
      `Studio selector prefix must match ${PREFIX_PATTERN} and contain at most ${MAX_PREFIX_LENGTH} characters`,
    );
  }
  return value;
}

function normalizeSkipElements(value: unknown): Set<string> {
  if (value === undefined) return new Set();

  let isArray: boolean;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    isArray = Array.isArray(value);
    descriptors = Object.getOwnPropertyDescriptors(value as object) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch {
    throw new TypeError("Studio selector skipElements must be a plain string array");
  }
  if (!isArray) {
    throw new TypeError("Studio selector skipElements must be a plain string array");
  }

  const length = descriptors.length?.value;
  const keys = Reflect.ownKeys(descriptors);
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_SKIP_ELEMENTS || keys.length !== length + 1 ||
    keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))
  ) {
    throw new TypeError(
      `Studio selector skipElements must contain at most ${MAX_SKIP_ELEMENTS} entries`,
    );
  }

  const normalized = new Set<string>();
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    const tagName = descriptor?.value;
    if (
      !descriptor?.enumerable || descriptor.get || descriptor.set ||
      typeof tagName !== "string" || tagName.length === 0 ||
      tagName.length > MAX_TAG_NAME_LENGTH || !TAG_NAME_PATTERN.test(tagName)
    ) {
      throw new TypeError("Studio selector skipElements entries must be valid HTML tag names");
    }
    normalized.add(tagName.toLowerCase());
  }
  return normalized;
}

function normalizeOptions(value: unknown): NormalizedInjectorOptions {
  if (value === undefined) {
    return { prefix: "vf", skipElements: new Set() };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Studio selector options must be a plain data record");
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch {
    throw new TypeError("Studio selector options must be a plain data record");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Studio selector options must be a plain data record");
  }

  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]!;
    if (typeof key !== "string" || descriptor.get || descriptor.set) {
      throw new TypeError("Studio selector options must contain only data properties");
    }
  }

  return {
    prefix: normalizePrefix(descriptors.prefix?.value),
    skipElements: normalizeSkipElements(descriptors.skipElements?.value),
  };
}

function* scanHtmlTags(html: string): Generator<HtmlTagToken> {
  let index = 0;
  let rawTextTag: string | null = null;

  while (index < html.length) {
    if (rawTextTag) {
      const closingIndex = findHtmlRawTextClosingTagStart(html, rawTextTag, index);
      if (closingIndex === -1) return;
      index = closingIndex;
      rawTextTag = null;
      continue;
    }

    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) return;
    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) return;
      index = commentEnd + 3;
      continue;
    }

    const tagEnd = findHtmlTagEnd(html, tagStart);
    if (tagEnd === -1) return;
    const source = html.slice(tagStart, tagEnd + 1);
    const closingTagName = getClosingHtmlTagName(source);
    const openingTagName = closingTagName ? undefined : getOpeningHtmlTagName(source);
    const tagName = closingTagName ?? openingTagName;
    if (!tagName) {
      // Text may legitimately contain `<` before a later tag. Advance only
      // past that character so the real tag can still be discovered.
      index = tagStart + 1;
      continue;
    }

    const selfClosing = isSelfClosingHtmlTag(source);
    yield {
      start: tagStart,
      end: tagEnd + 1,
      source,
      tagName,
      closing: closingTagName !== undefined,
      selfClosing,
    };

    index = tagEnd + 1;
    // HTML's plaintext state has no closing-tag escape; every remaining byte
    // is text even if it looks like markup.
    if (openingTagName === "plaintext" && !selfClosing) return;
    if (openingTagName && !selfClosing && RAW_TEXT_ELEMENTS.has(openingTagName)) {
      rawTextTag = openingTagName;
    }
  }
}

function inspectHtml(html: string): {
  rootStart: number | null;
  reservedSelectors: Set<string>;
} {
  let rootStart: number | null = null;
  const reservedSelectors = new Set<string>();

  for (const tag of scanHtmlTags(html)) {
    if (tag.closing) continue;
    for (const attributeName of ["data-vf-id", "data-vf-selector"]) {
      const value = findHtmlAttribute(tag.source, attributeName)?.value;
      if (value) reservedSelectors.add(value);
    }
    if (
      rootStart === null && tag.tagName === "div" &&
      findHtmlAttribute(tag.source, "id")?.value === "root"
    ) {
      rootStart = tag.start;
    }
  }

  return { rootStart, reservedSelectors };
}

function hasSelectorControlAttribute(tag: string): boolean {
  return ["data-vf-id", "data-vf-selector"].some(
    (attribute) => findHtmlAttribute(tag, attribute) !== undefined,
  );
}

function injectSelectorAttribute(tag: string, selector: string): string {
  const insertAt = getHtmlAttributeInsertionIndex(tag);
  if (insertAt === -1) return tag;

  return `${tag.slice(0, insertAt)} data-vf-selector="${selector}"${tag.slice(insertAt)}`;
}

function closeIgnoredElement(stack: string[], tagName: string): void {
  const matchingIndex = stack.lastIndexOf(tagName);
  if (matchingIndex !== -1) stack.length = matchingIndex;
}

/** Inject bounded, collision-free data-vf-selector attributes for Studio Navigator. */
export function injectElementSelectors(
  html: string,
  options: InjectorOptions = {},
): string {
  if (typeof html !== "string") {
    throw new TypeError("Studio selector input must be an HTML string");
  }
  const { prefix, skipElements } = normalizeOptions(options);
  const { rootStart, reservedSelectors } = inspectHtml(html);

  let counter = 0;
  let cursor = 0;
  let result = "";
  let insideRoot = rootStart === null;
  let rootDivDepth = 0;
  const ignoredElementStack: string[] = [];

  const nextSelector = (tagName: string): string => {
    let selector: string;
    do {
      selector = `${prefix}-${tagName}-${++counter}`;
    } while (reservedSelectors.has(selector));
    reservedSelectors.add(selector);
    return selector;
  };

  for (const tag of scanHtmlTags(html)) {
    result += html.slice(cursor, tag.start);
    let rewritten = tag.source;

    if (tag.closing) {
      if (insideRoot) {
        closeIgnoredElement(ignoredElementStack, tag.tagName);
        if (rootStart !== null && tag.tagName === "div" && rootDivDepth > 0) {
          rootDivDepth--;
        }
      }
    } else {
      if (!insideRoot && tag.start === rootStart) insideRoot = true;
      if (insideRoot) {
        const isVoid = VOID_ELEMENTS.has(tag.tagName) || tag.selfClosing;
        if (rootStart !== null && tag.tagName === "div" && !isVoid) rootDivDepth++;

        const ignoreSubtree = skipElements.has(tag.tagName) ||
          IGNORED_SUBTREE_ELEMENTS.has(tag.tagName) ||
          findHtmlAttribute(tag.source, "data-vf-ignore") !== undefined;
        const alreadyIgnored = ignoredElementStack.length > 0;
        if ((alreadyIgnored || ignoreSubtree) && !isVoid) {
          ignoredElementStack.push(tag.tagName);
        }

        const shouldInject = !alreadyIgnored && !ignoreSubtree &&
          !IGNORED_ELEMENT_ONLY.has(tag.tagName) &&
          !hasSelectorControlAttribute(tag.source);
        if (shouldInject) {
          rewritten = injectSelectorAttribute(tag.source, nextSelector(tag.tagName));
        }
      }
    }

    result += rewritten;
    cursor = tag.end;
    if (rootStart !== null && insideRoot && rootDivDepth === 0 && tag.closing) {
      insideRoot = false;
      ignoredElementStack.length = 0;
    }
  }

  return result + html.slice(cursor);
}

/** Check if Studio embed mode is enabled from URL. */
export function isStudioEmbed(url: URL | string): boolean {
  try {
    const urlObj = typeof url === "string" ? new URL(url) : url;
    return urlObj.searchParams.get("studio_embed") === "true";
  } catch {
    return false;
  }
}
