import { normalizeModulePath } from "#veryfront/modules/loader-shared/cross-project-request.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";

export const DATA_ENDPOINT_PREFIX = "/_veryfront/data/";

export interface DataEndpointPath {
  matched: true;
  slug: string;
}

export interface NonDataEndpointPath {
  matched: false;
}

export class InvalidDataEndpointPathError extends TypeError {
  override readonly name = "InvalidDataEndpointPathError";
}

function invalidDataEndpointPath(message: string): never {
  throw new InvalidDataEndpointPathError(message);
}

/**
 * Parse a data endpoint pathname without substring replacement or repeated
 * decoding. A matched namespace with an invalid shape throws so callers can
 * distinguish bad requests from unrelated routes.
 */
export function parseDataEndpointPath(
  pathname: string,
): DataEndpointPath | NonDataEndpointPath {
  if (typeof pathname !== "string") {
    return invalidDataEndpointPath("Data endpoint pathname must be a string");
  }
  if (!pathname.startsWith(DATA_ENDPOINT_PREFIX)) return { matched: false };
  if (
    pathname.length > MAX_PATH_LENGTH_CHARS ||
    !pathname.endsWith(".json")
  ) {
    return invalidDataEndpointPath(
      "Data endpoint pathname must be a bounded .json path",
    );
  }

  const encodedSlug = pathname.slice(DATA_ENDPOINT_PREFIX.length, -".json".length);
  if (encodedSlug.length === 0) return { matched: true, slug: "" };

  try {
    return {
      matched: true,
      slug: normalizeModulePath(encodedSlug, {
        percentEncoded: true,
        subject: "Data endpoint slug",
      }),
    };
  } catch {
    return invalidDataEndpointPath("Data endpoint slug is invalid");
  }
}
