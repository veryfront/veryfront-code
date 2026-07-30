import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { normalizeStudioBridgeOptions, startStudioBridge } from "./bridge-coordinator.ts";
import { captureScreenshot, MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR } from "./bridge-screenshot.ts";

Deno.test("Studio bridge options reject hostile values without invoking accessors", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "captureProvider", {
    enumerable: true,
    get() {
      getterCalls++;
      return () => Promise.resolve({} as HTMLCanvasElement);
    },
  });

  assertThrows(
    () => normalizeStudioBridgeOptions(accessor),
    TypeError,
    "enumerable data property",
  );
  assertEquals(getterCalls, 0);
  assertThrows(
    () => normalizeStudioBridgeOptions({ captureProvider: () => Promise.resolve({}), extra: 1 }),
    TypeError,
    'only "captureProvider"',
  );

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assertThrows(
    () => normalizeStudioBridgeOptions(proxy),
    TypeError,
    "could not be inspected",
  );
});

Deno.test("Studio bridge owns one restartable capability generation", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalConfig = Object.getOwnPropertyDescriptor(
    globalThis,
    "__VF_BRIDGE_CONFIG__",
  );
  const fakeWindow = {
    parent: null as unknown,
    location: { search: "", href: "https://preview.example/page" },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Window;
  Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", {
    configurable: true,
    value: Object.freeze({
      projectId: "project",
      pageId: "page",
      pagePath: "app/page.tsx",
      nonce: "",
    }),
  });

  let installation: ReturnType<typeof startStudioBridge> | undefined;
  let replacement: ReturnType<typeof startStudioBridge> | undefined;
  try {
    installation = startStudioBridge({
      captureProvider: () => Promise.resolve({} as HTMLCanvasElement),
    });
    assertThrows(() => startStudioBridge(), Error, "already started");

    installation.dispose();
    installation.dispose();
    assertEquals(await captureScreenshot(), {
      success: false,
      error: MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR,
    });

    replacement = startStudioBridge();
    replacement.dispose();
  } finally {
    try {
      replacement?.dispose();
      installation?.dispose();
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (originalConfig) {
        Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", originalConfig);
      } else {
        Reflect.deleteProperty(globalThis, "__VF_BRIDGE_CONFIG__");
      }
    }
  }
});

Deno.test("Studio bridge retires a failed startup before allowing restart", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalConfig = Object.getOwnPropertyDescriptor(
    globalThis,
    "__VF_BRIDGE_CONFIG__",
  );
  let removeCalls = 0;
  const fakeWindow = {
    parent: null as unknown,
    location: { search: "", href: "https://preview.example/page" },
    addEventListener() {},
    removeEventListener() {
      removeCalls++;
      if (removeCalls === 1) throw new Error("transient listener cleanup failure");
    },
  } as unknown as Window;
  Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", {
    configurable: true,
    get() {
      throw new Error("config accessor must not run");
    },
  });

  let restarted: ReturnType<typeof startStudioBridge> | undefined;
  let finalGeneration: ReturnType<typeof startStudioBridge> | undefined;
  try {
    const startupFailure = assertThrows(
      () =>
        startStudioBridge({
          captureProvider: () => Promise.resolve({} as HTMLCanvasElement),
        }),
      AggregateError,
      "cleanup is incomplete",
    );
    assertEquals(startupFailure.errors.length, 2);
    assertEquals(removeCalls, 1);
    assertEquals(await captureScreenshot(), {
      success: false,
      error: MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR,
    });

    Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", {
      configurable: true,
      value: Object.freeze({
        projectId: "project",
        pageId: "page",
        pagePath: "app/page.tsx",
        nonce: "",
      }),
    });

    // The next start first completes the failed generation's retained cleanup,
    // then installs a new generation in the same call.
    restarted = startStudioBridge();
    assertEquals(removeCalls, 4);
    restarted.dispose();
    finalGeneration = startStudioBridge();
    finalGeneration.dispose();
  } finally {
    try {
      finalGeneration?.dispose();
      restarted?.dispose();
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (originalConfig) {
        Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", originalConfig);
      } else {
        Reflect.deleteProperty(globalThis, "__VF_BRIDGE_CONFIG__");
      }
    }
  }
});
