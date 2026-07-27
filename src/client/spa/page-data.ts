import type { SpaPageData } from "#veryfront/routing/client/types.ts";
import { RELEASE_ASSET_MANIFEST_LIMITS } from "#veryfront/release-assets/constants.ts";
import { hasControlCharacters } from "#veryfront/release-assets/string-validation.ts";

/** Legacy name retained for callers of the SPA client entrypoint. */
export type PageDataResponse = SpaPageData;

const MAX_PAGE_DATA_LAYOUTS = 256;
const MAX_PAGE_DATA_PROVIDERS = 512;
const MAX_PAGE_DATA_PARAMS = 512;
const MAX_PAGE_DATA_TEXT_LENGTH = RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength;
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
  return copyDenseArray(value, "layouts", MAX_PAGE_DATA_LAYOUTS).map((entry, index) => {
    const layout = copyRecord(entry, `layouts[${index}]`);
    const kind = layout.kind;
    if (kind !== "mdx" && kind !== "tsx") {
      throw new TypeError(`layouts[${index}].kind is invalid`);
    }
    return {
      kind,
      path: requireBoundedText(layout.path, `layouts[${index}].path`),
    };
  });
}

function copyProviders(value: unknown): string[] {
  return copyDenseArray(value, "providers", MAX_PAGE_DATA_PROVIDERS).map(
    (provider, index) => requireBoundedText(provider, `providers[${index}]`),
  );
}

function copyParams(value: unknown): Record<string, string | string[]> {
  const params = readOwnEnumerableDataEntries(value ?? {}, "params");
  if (params.length > MAX_PAGE_DATA_PARAMS) {
    throw new TypeError(`params must contain at most ${MAX_PAGE_DATA_PARAMS} entries`);
  }

  return Object.fromEntries(
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
        segments.map((segment, index) =>
          requireBoundedText(
            segment,
            `params.${canonicalKey}[${index}]`,
            true,
          )
        ),
      ];
    }),
  );
}

function copyLayoutProps(
  value: unknown,
): Record<string, Record<string, unknown>> {
  const entries = readOwnEnumerableDataEntries(value ?? {}, "layoutProps");
  if (entries.length > MAX_PAGE_DATA_LAYOUTS) {
    throw new TypeError(`layoutProps must contain at most ${MAX_PAGE_DATA_LAYOUTS} entries`);
  }

  return Object.fromEntries(
    entries.map(([path, props]) => [
      requireBoundedText(path, "layoutProps path"),
      copyRecord(props, `layoutProps.${path}`),
    ]),
  );
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
    frontmatter: copyRecord(value.frontmatter ?? {}, "frontmatter"),
    props: copyRecord(value.props ?? {}, "props"),
    params: copyParams(value.params),
    layoutProps: copyLayoutProps(value.layoutProps),
  };

  const redirectValue = value.redirect;
  if (redirectValue !== undefined) {
    const redirect = requireRecord(redirectValue, "redirect");
    snapshot.redirect = {
      destination: requireBoundedText(redirect.destination, "redirect.destination"),
      ...(typeof redirect.permanent === "boolean" ? { permanent: redirect.permanent } : {}),
    };
  }

  return snapshot;
}
