import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  MAX_ISOLATED_SSR_RENDERER_READ_ROOTS,
  snapshotIsolatedSsrRendererProvider,
  validateIsolatedSsrRendererModuleUrl,
} from "./isolated-ssr-renderer.ts";

Deno.test("isolated SSR renderer provider snapshots immutable local module metadata", () => {
  const source = {
    moduleUrl: "file:///opt/veryfront/ext-react-ssr/worker-renderer.ts",
    readRootUrls: ["file:///opt/veryfront/ext-react-ssr/"],
  };
  const provider = snapshotIsolatedSsrRendererProvider(source);
  source.moduleUrl = "file:///tmp/mutated.ts";
  source.readRootUrls[0] = "file:///tmp/";

  assertEquals(
    provider.moduleUrl,
    "file:///opt/veryfront/ext-react-ssr/worker-renderer.ts",
  );
  assertEquals(provider.readRootUrls, ["file:///opt/veryfront/ext-react-ssr/"]);
  assertEquals(Object.isFrozen(provider), true);
  assertEquals(Object.isFrozen(provider.readRootUrls), true);
});

Deno.test("isolated SSR renderer provider rejects accessors without executing them", () => {
  let getterCalls = 0;
  const provider = Object.defineProperties({}, {
    moduleUrl: {
      enumerable: true,
      get() {
        getterCalls++;
        return "file:///tmp/renderer.ts";
      },
    },
    readRootUrls: {
      enumerable: true,
      value: ["file:///tmp/"],
    },
  });

  assertThrows(
    () => snapshotIsolatedSsrRendererProvider(provider),
    TypeError,
    "moduleUrl must be a data property",
  );
  assertEquals(getterCalls, 0);
});

Deno.test("isolated SSR renderer provider rejects ambiguous and sparse objects", () => {
  assertThrows(
    () =>
      snapshotIsolatedSsrRendererProvider({
        moduleUrl: "file:///tmp/renderer.ts",
        readRootUrls: ["file:///tmp/"],
        fallbackModuleUrl: "file:///tmp/fallback.ts",
      }),
    TypeError,
    "must contain only",
  );
  const sparse = new Array<string>(1);
  assertThrows(
    () =>
      snapshotIsolatedSsrRendererProvider({
        moduleUrl: "file:///tmp/renderer.ts",
        readRootUrls: sparse,
      }),
    TypeError,
    "dense bounded array",
  );
});

Deno.test("isolated SSR renderer provider rejects non-local and decorated module URLs", () => {
  for (
    const value of [
      "react-renderer.ts",
      "https://cdn.example/renderer.ts",
      "file:relative.ts",
      "file://server/share/renderer.ts",
      "file:///tmp/renderer.ts?version=1",
      "file:///tmp/renderer.ts#entry",
      "file:///tmp/renderer/",
    ]
  ) {
    assertThrows(
      () => validateIsolatedSsrRendererModuleUrl(value),
      TypeError,
      "absolute local file URL",
    );
  }
});

Deno.test("isolated SSR renderer provider rejects revoked objects", () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assertThrows(
    () => snapshotIsolatedSsrRendererProvider(proxy),
    TypeError,
    "could not be inspected",
  );
});

Deno.test("isolated SSR renderer provider rejects transparent proxies and exotic prototypes", () => {
  const source = {
    moduleUrl: "file:///tmp/renderer.ts",
    readRootUrls: ["file:///tmp/"],
  };
  assertThrows(
    () => snapshotIsolatedSsrRendererProvider(new Proxy(source, {})),
    TypeError,
    "could not be inspected",
  );
  assertThrows(
    () =>
      snapshotIsolatedSsrRendererProvider(
        Object.assign(Object.create({ inherited: true }), source),
      ),
    TypeError,
    "plain object",
  );
  assertThrows(
    () =>
      snapshotIsolatedSsrRendererProvider({
        moduleUrl: source.moduleUrl,
        readRootUrls: new Proxy(source.readRootUrls, {}),
      }),
    TypeError,
    "could not be inspected",
  );
});

Deno.test("isolated SSR renderer provider inspection is independent of replaced globals", () => {
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
      value: () => false,
    });
    assertEquals(
      snapshotIsolatedSsrRendererProvider({
        moduleUrl: "file:///tmp/renderer.ts",
        readRootUrls: ["file:///tmp/"],
      }).moduleUrl,
      "file:///tmp/renderer.ts",
    );
  } finally {
    if (descriptors) Object.defineProperty(Object, "getOwnPropertyDescriptors", descriptors);
    if (ownKeys) Object.defineProperty(Reflect, "ownKeys", ownKeys);
    if (isArray) Object.defineProperty(Array, "isArray", isArray);
  }
});

Deno.test("isolated SSR renderer provider rejects non-directory and non-local read roots", () => {
  for (
    const value of [
      "ext-react-ssr/",
      "https://cdn.example/",
      "file:///opt/veryfront/?v=1",
      "file:///opt/veryfront/#root",
      "file://server/share/",
      "file:///opt/veryfront/worker-renderer.ts",
    ]
  ) {
    assertThrows(
      () =>
        snapshotIsolatedSsrRendererProvider({
          moduleUrl: "file:///opt/veryfront/worker-renderer.ts",
          readRootUrls: ["file:///opt/veryfront/", value],
        }),
      TypeError,
      "readRootUrls[1] must be an absolute local file URL",
      `read root ${value} must be rejected as a sandbox read root`,
    );
  }
});

Deno.test("isolated SSR renderer provider rejects empty and oversized read root arrays", () => {
  assertThrows(
    () =>
      snapshotIsolatedSsrRendererProvider({
        moduleUrl: "file:///opt/veryfront/worker-renderer.ts",
        readRootUrls: [],
      }),
    TypeError,
    "dense bounded array",
    "a provider must declare at least one read root",
  );
  assertThrows(
    () =>
      snapshotIsolatedSsrRendererProvider({
        moduleUrl: "file:///opt/veryfront/worker-renderer.ts",
        readRootUrls: Array.from(
          { length: MAX_ISOLATED_SSR_RENDERER_READ_ROOTS + 1 },
          (_unused, index) => `file:///opt/veryfront/root-${index}/`,
        ),
      }),
    TypeError,
    "dense bounded array",
    "read roots beyond the documented cap must be rejected",
  );
  assertEquals(
    snapshotIsolatedSsrRendererProvider({
      moduleUrl: "file:///opt/veryfront/worker-renderer.ts",
      readRootUrls: Array.from(
        { length: MAX_ISOLATED_SSR_RENDERER_READ_ROOTS },
        (_unused, index) => `file:///opt/veryfront/root-${index}/`,
      ),
    }).readRootUrls.length,
    MAX_ISOLATED_SSR_RENDERER_READ_ROOTS,
    "read roots exactly at the cap must be accepted",
  );
});
