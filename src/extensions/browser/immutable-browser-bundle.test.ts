import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { snapshotImmutableBrowserBundleProvider } from "./immutable-browser-bundle.ts";

Deno.test("immutable browser bundle inspection is independent of replaced globals", () => {
  const descriptors = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptors");
  const ownKeys = Object.getOwnPropertyDescriptor(Reflect, "ownKeys");
  const isArray = Object.getOwnPropertyDescriptor(Array, "isArray");
  try {
    Object.defineProperty(Object, "getOwnPropertyDescriptors", {
      configurable: true,
      value: () => ({}),
    });
    Object.defineProperty(Reflect, "ownKeys", {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(Array, "isArray", {
      configurable: true,
      value: () => true,
    });
    assertEquals(
      snapshotImmutableBrowserBundleProvider(
        { browserBundle: "console.log('safe');" },
        { bundleLabel: "bundle", providerLabel: "provider", maxBytes: 1_024 },
      ).browserBundle,
      "console.log('safe');",
      "inspection must use the captured intrinsics, not the replaced globals",
    );
  } finally {
    if (descriptors) Object.defineProperty(Object, "getOwnPropertyDescriptors", descriptors);
    if (ownKeys) Object.defineProperty(Reflect, "ownKeys", ownKeys);
    if (isArray) Object.defineProperty(Array, "isArray", isArray);
  }

  assertThrows(
    () =>
      snapshotImmutableBrowserBundleProvider(
        Object.assign([], { browserBundle: "console.log('x');" }),
        { bundleLabel: "bundle", providerLabel: "provider", maxBytes: 1_024 },
      ),
    TypeError,
    "provider must be an object",
    "an array carrying a browserBundle property must be rejected",
  );
});
