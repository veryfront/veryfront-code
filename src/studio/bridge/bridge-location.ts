/** Shared, bounded location metadata for Studio bridge messages. */

import { MAX_STUDIO_URL_LENGTH } from "../limits.ts";
import { REDACTED, sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";

export interface StudioLocationOptions {
  includeSearch?: boolean;
  includeHash?: boolean;
}

function boundedHref(url: URL): string | null {
  const href = url.href;
  return href.length <= MAX_STUDIO_URL_LENGTH ? href : null;
}

function sanitizeLocationSearch(url: URL): void {
  if (!url.search) return;
  url.search = sanitizeUrlCredentials(url.search);
}

function sanitizeLocationHash(url: URL): void {
  if (!url.hash) return;
  if (sanitizeUrlCredentials(url.hash) !== url.hash) {
    url.hash = REDACTED;
    return;
  }
  const encodedValue = url.hash.slice(1);
  let value = encodedValue;
  try {
    value = decodeURIComponent(encodedValue);
  } catch {
    // The encoded form is still checked and can be retained when it is benign.
  }
  if (sanitizeUrlCredentials(value) !== value) url.hash = REDACTED;
}

/**
 * Return the current HTTP(S) location within the Studio protocol bound.
 *
 * Optional URL components are removed in semantic units when necessary. This
 * avoids producing a syntactically invalid URL by slicing serialized output.
 */
export function getStudioLocationHref(options: StudioLocationOptions = {}): string {
  let href: unknown;
  try {
    href = globalThis.window.location.href;
  } catch {
    return "";
  }
  if (typeof href !== "string") return "";

  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";

    url.username = "";
    url.password = "";
    if (options.includeSearch === false) url.search = "";
    else sanitizeLocationSearch(url);
    if (options.includeHash === false) url.hash = "";
    else sanitizeLocationHash(url);

    const complete = boundedHref(url);
    if (complete) return complete;

    url.hash = "";
    const withoutHash = boundedHref(url);
    if (withoutHash) return withoutHash;

    url.search = "";
    const withoutSearch = boundedHref(url);
    if (withoutSearch) return withoutSearch;

    url.pathname = "/";
    return boundedHref(url) ?? "";
  } catch {
    return "";
  }
}
