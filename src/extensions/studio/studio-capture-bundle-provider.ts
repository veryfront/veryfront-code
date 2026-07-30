/**
 * Server-side contract for an extension-owned Studio browser bundle.
 *
 * Core owns the transport and protocol. An explicitly configured extension
 * owns the third-party browser implementation and supplies a complete bundle
 * that was built against the same public Studio bridge composition surface.
 */

import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

export const StudioCaptureBundleProviderName = "StudioCaptureBundleProvider";
export const MAX_STUDIO_CAPTURE_BUNDLE_BYTES = MAX_BUNDLE_CHUNK_SIZE_BYTES;

const textEncoder = new TextEncoder();

export interface StudioCaptureBundleProvider {
  /** Self-contained ESM bridge bundle with the capture capability installed. */
  readonly browserBundle: string;
}

function assertCanonicalBundleString(value: string): void {
  if (value.length === 0 || /^\s*$/u.test(value)) {
    throw new TypeError(
      "Studio bridge bundle must be a non-empty JavaScript string",
    );
  }
  if (value.charCodeAt(0) === 0xfeff) {
    throw new TypeError("Studio bridge bundle must not start with a BOM");
  }

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      throw new TypeError("Studio bridge bundle must not contain NUL");
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!Number.isInteger(trailing) || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new TypeError(
          "Studio bridge bundle must contain canonical Unicode",
        );
      }
      index++;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(
        "Studio bridge bundle must contain canonical Unicode",
      );
    }
  }
}

/** Validate the shared format and UTF-8 byte budget for every Studio bridge bundle. */
export function validateStudioCaptureBundle(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Studio bridge bundle must be a string");
  }
  // A UTF-16 code unit always occupies at least one UTF-8 byte. Rejecting on
  // code-unit length first avoids scanning or allocating for oversized input.
  if (value.length > MAX_STUDIO_CAPTURE_BUNDLE_BYTES) {
    throw new RangeError(
      `Studio bridge bundle exceeds the ${MAX_STUDIO_CAPTURE_BUNDLE_BYTES}-byte limit`,
    );
  }
  assertCanonicalBundleString(value);
  if (textEncoder.encode(value).byteLength > MAX_STUDIO_CAPTURE_BUNDLE_BYTES) {
    throw new RangeError(
      `Studio bridge bundle exceeds the ${MAX_STUDIO_CAPTURE_BUNDLE_BYTES}-byte limit`,
    );
  }
  return value;
}

/**
 * Snapshot an untrusted extension contract without invoking accessors.
 *
 * The snapshot enforces the shared bundle format and UTF-8 byte budget before
 * a bootstrap generation can be published. The loader reuses the validator.
 */
export function snapshotStudioCaptureBundleProvider(
  value: unknown,
): Readonly<StudioCaptureBundleProvider> {
  if (!value || typeof value !== "object") {
    throw new TypeError("Studio capture bundle provider must be an object");
  }

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError("Studio capture bundle provider could not be inspected", { cause });
  }
  if (isArray) throw new TypeError("Studio capture bundle provider must be an object");

  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 1 || keys[0] !== "browserBundle") {
    throw new TypeError(
      'Studio capture bundle provider must contain only the "browserBundle" property',
    );
  }
  const descriptor = descriptors.browserBundle;
  if (
    !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set ||
    typeof descriptor.value !== "string"
  ) {
    throw new TypeError(
      "Studio capture bundle provider browserBundle must be a string data property",
    );
  }

  return Object.freeze({ browserBundle: validateStudioCaptureBundle(descriptor.value) });
}

/** Create an immutable provider suitable for extension contract registration. */
export function createStudioCaptureBundleProvider(
  browserBundle: string,
): Readonly<StudioCaptureBundleProvider> {
  return snapshotStudioCaptureBundleProvider({ browserBundle });
}
