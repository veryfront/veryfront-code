import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  createStudioCaptureBundleProvider,
  MAX_STUDIO_CAPTURE_BUNDLE_BYTES,
  snapshotStudioCaptureBundleProvider,
} from "./studio-capture-bundle-provider.ts";

Deno.test("Studio capture bundle provider snapshots immutable bundle data", () => {
  const source = { browserBundle: "export const capture = true;" };
  const provider = snapshotStudioCaptureBundleProvider(source);
  source.browserBundle = "mutated";

  assertEquals(provider.browserBundle, "export const capture = true;");
  assertEquals(Object.isFrozen(provider), true);
});

Deno.test("Studio capture bundle provider rejects accessors without executing them", () => {
  let getterCalls = 0;
  const provider = Object.defineProperty({}, "browserBundle", {
    enumerable: true,
    get() {
      getterCalls++;
      return "malicious";
    },
  });

  assertThrows(
    () => snapshotStudioCaptureBundleProvider(provider),
    TypeError,
    "browserBundle must be a string data property",
  );
  assertEquals(getterCalls, 0);
});

Deno.test("Studio capture bundle provider rejects ambiguous and revoked objects", () => {
  assertThrows(
    () => snapshotStudioCaptureBundleProvider({ browserBundle: "bundle", fallback: "cdn" }),
    TypeError,
    'must contain only the "browserBundle" property',
  );
  assertThrows(
    () => createStudioCaptureBundleProvider(""),
    TypeError,
    "bundle must be a non-empty JavaScript string",
  );

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assertThrows(
    () => snapshotStudioCaptureBundleProvider(proxy),
    TypeError,
    "could not be inspected",
  );
});

Deno.test("Studio capture bundle provider enforces the UTF-8 boundary", () => {
  const atBoundary = "é".repeat(MAX_STUDIO_CAPTURE_BUNDLE_BYTES / 2);
  assertEquals(
    createStudioCaptureBundleProvider(atBoundary).browserBundle.length,
    MAX_STUDIO_CAPTURE_BUNDLE_BYTES / 2,
  );
  assertThrows(
    () => createStudioCaptureBundleProvider(atBoundary + "a"),
    RangeError,
    `${MAX_STUDIO_CAPTURE_BUNDLE_BYTES}-byte limit`,
  );
});

Deno.test("Studio capture bundle provider rejects noncanonical source strings", () => {
  for (
    const source of [
      "   \n",
      "\ufeffexport {};",
      "export {};\0",
      "export { '\ud800' };",
      "\ud800",
      "\udc00",
    ]
  ) {
    assertThrows(() => createStudioCaptureBundleProvider(source), TypeError);
  }
});
