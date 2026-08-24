import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  createDevUiAssetProvider,
  MAX_DEV_UI_BUNDLE_BYTES,
  snapshotDevUiAssetProvider,
} from "./dev-ui-asset-provider.ts";

Deno.test("Development UI asset provider snapshots one immutable local bundle", () => {
  const source = { browserBundle: "export const local = true;" };
  const provider = snapshotDevUiAssetProvider(source);
  source.browserBundle = "mutated";

  assertEquals(provider.browserBundle, "export const local = true;");
  assertEquals(Object.isFrozen(provider), true);
});

Deno.test("Development UI asset provider rejects accessors and fallback metadata", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "browserBundle", {
    enumerable: true,
    get() {
      getterCalls++;
      return "malicious";
    },
  });

  assertThrows(
    () => snapshotDevUiAssetProvider(accessor),
    TypeError,
    "string data property",
  );
  assertEquals(getterCalls, 0);
  assertThrows(
    () => snapshotDevUiAssetProvider({ browserBundle: "bundle", cdnFallback: true }),
    TypeError,
    'only the "browserBundle" property',
  );
});

Deno.test("Development UI asset provider rejects proxies without invoking traps", () => {
  let trapCalls = 0;
  const proxied = new Proxy({ browserBundle: "export {};" }, {
    getOwnPropertyDescriptor() {
      trapCalls++;
      throw new Error("must not inspect proxy descriptors");
    },
  });

  assertThrows(() => snapshotDevUiAssetProvider(proxied), TypeError, "must be an object");
  assertEquals(trapCalls, 0);
});

Deno.test("Development UI asset provider enforces canonical source and byte limits", () => {
  for (const source of ["", " \n", "\ufeffexport {};", "export {};\0", "\ud800"]) {
    assertThrows(() => createDevUiAssetProvider(source), TypeError);
  }

  const atBoundary = "a".repeat(MAX_DEV_UI_BUNDLE_BYTES);
  assertEquals(createDevUiAssetProvider(atBoundary).browserBundle.length, atBoundary.length);
  assertThrows(
    () => createDevUiAssetProvider(`${atBoundary}a`),
    RangeError,
    `${MAX_DEV_UI_BUNDLE_BYTES}-byte limit`,
  );

  const multiByte = "\u{1F600}".repeat(MAX_DEV_UI_BUNDLE_BYTES / 4 + 1);
  assertEquals(
    multiByte.length <= MAX_DEV_UI_BUNDLE_BYTES,
    true,
    "the multi-byte fixture must pass the UTF-16 length pre-check",
  );
  assertThrows(
    () => createDevUiAssetProvider(multiByte),
    RangeError,
    `${MAX_DEV_UI_BUNDLE_BYTES}-byte limit`,
    "a multi-byte bundle must be measured in UTF-8 bytes",
  );
});
