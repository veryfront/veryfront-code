import type { SpaPageData } from "#veryfront/routing/client/types.ts";
import { hasControlCharacters, MAX_SPA_RESOURCE_KEY_LENGTH } from "./validation.ts";

/** Legacy name retained for callers of the SPA client entrypoint. */
export type PageDataResponse = SpaPageData;

const MAX_PAGE_DATA_LAYOUTS = 256;
const MAX_PAGE_DATA_PROVIDERS = 512;
const MAX_PAGE_DATA_PARAMS = 512;
const MAX_PAGE_DATA_TEXT_LENGTH = MAX_SPA_RESOURCE_KEY_LENGTH;
const MAX_PAGE_DATA_VALUE_DEPTH = 64;
const MAX_PAGE_DATA_VALUE_ENTRIES = 65_536;
const PAGE_DATA_TYPES = new Set<PageDataResponse["pageType"]>([
  "mdx",
  "md",
  "tsx",
  "jsx",
  "ts",
  "js",
]);

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readOwnEnumerableDataEntries(
  value: unknown,
  fieldName: string,
): Array<[string, unknown]> {
  const record = requireRecord(value, fieldName);
  try {
    const entries: Array<[string, unknown]> = [];
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== "string") continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
      if (!descriptor) {
        throw new TypeError(`${fieldName}.${key} changed while being captured`);
      }
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        throw new TypeError(`${fieldName}.${key} must be a data property`);
      }
      entries.push([key, descriptor.value]);
    }
    return entries;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${fieldName} could not be captured`);
  }
}

function copyRecord(value: unknown, fieldName: string): Record<string, unknown> {
  return Object.fromEntries(readOwnEnumerableDataEntries(value ?? {}, fieldName));
}

interface PageDataValueCapture {
  activeContainers: WeakSet<object>;
  remainingEntries: number;
}

function consumeValueEntries(capture: PageDataValueCapture, count: number): void {
  if (count > capture.remainingEntries) {
    throw new TypeError(
      `Page data values must contain at most ${MAX_PAGE_DATA_VALUE_ENTRIES} entries`,
    );
  }
  capture.remainingEntries -= count;
}

function copyJsonValue(
  value: unknown,
  fieldName: string,
  capture: PageDataValueCapture,
  depth: number,
): unknown {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${fieldName} must contain only finite numbers`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${fieldName} must contain only JSON values`);
  }
  if (depth >= MAX_PAGE_DATA_VALUE_DEPTH) {
    throw new TypeError(
      `Page data values must be nested at most ${MAX_PAGE_DATA_VALUE_DEPTH} levels`,
    );
  }
  if (capture.activeContainers.has(value)) {
    throw new TypeError(`${fieldName} must not contain circular references`);
  }

  capture.activeContainers.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = copyDenseArray(
        value,
        fieldName,
        Math.min(MAX_PAGE_DATA_VALUE_ENTRIES, capture.remainingEntries),
      );
      consumeValueEntries(capture, entries.length);
      const result = entries.map((entry) => copyJsonValue(entry, fieldName, capture, depth + 1));
      Object.freeze(result);
      return result;
    }

    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(value);
    } catch (cause) {
      throw new TypeError(`${fieldName} could not be inspected`, { cause });
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${fieldName} must contain only plain JSON objects`);
    }

    const entries = readOwnEnumerableDataEntries(value, fieldName);
    consumeValueEntries(capture, entries.length);
    const result = Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        copyJsonValue(entry, fieldName, capture, depth + 1),
      ]),
    );
    Object.freeze(result);
    return result;
  } finally {
    capture.activeContainers.delete(value);
  }
}

function copyJsonRecord(
  value: unknown,
  fieldName: string,
  capture: PageDataValueCapture,
): Record<string, unknown> {
  const copied = copyJsonValue(value ?? {}, fieldName, capture, 0);
  if (typeof copied !== "object" || copied === null || Array.isArray(copied)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return copied as Record<string, unknown>;
}

function copyDenseArray(value: unknown, fieldName: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  try {
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) ||
      length < 0 || length > maxLength
    ) {
      throw new TypeError(`${fieldName} must contain at most ${maxLength} entries`);
    }

    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${fieldName}[${index}] must be a data property`);
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${fieldName} could not be captured`);
  }
}

function requireBoundedText(
  value: unknown,
  fieldName: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > MAX_PAGE_DATA_TEXT_LENGTH || hasControlCharacters(value)
  ) {
    throw new TypeError(
      `${fieldName} must contain ${
        allowEmpty ? "0" : "1"
      }-${MAX_PAGE_DATA_TEXT_LENGTH} control-free characters`,
    );
  }
  return value;
}

function copyLayouts(value: unknown): PageDataResponse["layouts"] {
  const layouts = copyDenseArray(value, "layouts", MAX_PAGE_DATA_LAYOUTS).map((entry, index) => {
    const layout = copyRecord(entry, `layouts[${index}]`);
    const kind = layout.kind;
    if (kind !== "mdx" && kind !== "tsx") {
      throw new TypeError(`layouts[${index}].kind is invalid`);
    }
    return Object.freeze({
      kind,
      path: requireBoundedText(layout.path, `layouts[${index}].path`),
    });
  });
  Object.freeze(layouts);
  return layouts;
}

function copyProviders(value: unknown): string[] {
  const providers = copyDenseArray(value, "providers", MAX_PAGE_DATA_PROVIDERS).map(
    (provider, index) => requireBoundedText(provider, `providers[${index}]`),
  );
  Object.freeze(providers);
  return providers;
}

function copyParams(value: unknown): Record<string, string | string[]> {
  const params = readOwnEnumerableDataEntries(value ?? {}, "params");
  if (params.length > MAX_PAGE_DATA_PARAMS) {
    throw new TypeError(`params must contain at most ${MAX_PAGE_DATA_PARAMS} entries`);
  }

  const copied = Object.fromEntries(
    params.map(([key, parameter]) => {
      const canonicalKey = requireBoundedText(key, "params key");
      if (typeof parameter === "string") {
        return [
          canonicalKey,
          requireBoundedText(parameter, `params.${canonicalKey}`, true),
        ];
      }
      const segments = copyDenseArray(
        parameter,
        `params.${canonicalKey}`,
        MAX_PAGE_DATA_PARAMS,
      );
      return [
        canonicalKey,
        Object.freeze(segments.map((segment, index) =>
          requireBoundedText(
            segment,
            `params.${canonicalKey}[${index}]`,
            true,
          )
        )),
      ];
    }),
  );
  Object.freeze(copied);
  return copied;
}

function copyLayoutProps(
  value: unknown,
  capture: PageDataValueCapture,
): Record<string, Record<string, unknown>> {
  const entries = readOwnEnumerableDataEntries(value ?? {}, "layoutProps");
  if (entries.length > MAX_PAGE_DATA_LAYOUTS) {
    throw new TypeError(`layoutProps must contain at most ${MAX_PAGE_DATA_LAYOUTS} entries`);
  }

  consumeValueEntries(capture, entries.length);
  const copied = Object.fromEntries(
    entries.map(([path, props]) => [
      requireBoundedText(path, "layoutProps path"),
      copyJsonRecord(props, "layoutProps entry", capture),
    ]),
  );
  Object.freeze(copied);
  return copied;
}

/**
 * Capture one stable, bounded view of page data before asynchronous imports.
 *
 * Page-data responses originate as JSON, but the legacy ClientApp entrypoint is
 * also directly callable. Capturing enumerable data descriptors once and
 * rebuilding the immediate control surface as plain records and dense arrays
 * prevents accessors or later caller mutation from changing which component is
 * loaded versus which state is committed.
 */
export function snapshotPageData(data: PageDataResponse): PageDataResponse {
  const value = copyRecord(data, "SPA page data");
  const valueCapture: PageDataValueCapture = {
    activeContainers: new WeakSet(),
    remainingEntries: MAX_PAGE_DATA_VALUE_ENTRIES,
  };
  const pageType = value.pageType;
  if (
    typeof pageType !== "string" || !PAGE_DATA_TYPES.has(pageType as PageDataResponse["pageType"])
  ) {
    throw new TypeError("pageType is invalid");
  }

  const snapshot: PageDataResponse = {
    slug: requireBoundedText(value.slug, "slug", true),
    pagePath: requireBoundedText(value.pagePath, "pagePath", true),
    pageType: pageType as PageDataResponse["pageType"],
    layouts: copyLayouts(value.layouts ?? []),
    providers: copyProviders(value.providers ?? []),
    frontmatter: copyJsonRecord(value.frontmatter ?? {}, "frontmatter", valueCapture),
    props: copyJsonRecord(value.props ?? {}, "props", valueCapture),
    params: copyParams(value.params),
    layoutProps: copyLayoutProps(value.layoutProps, valueCapture),
  };

  const redirectValue = value.redirect;
  if (redirectValue !== undefined) {
    const redirect = requireRecord(redirectValue, "redirect");
    snapshot.redirect = Object.freeze({
      destination: requireBoundedText(redirect.destination, "redirect.destination"),
      ...(typeof redirect.permanent === "boolean" ? { permanent: redirect.permanent } : {}),
    });
  }

  Object.freeze(snapshot);
  return snapshot;
}
