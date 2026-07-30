import { assertEquals, assertThrows } from "@std/assert";
import { IsolatedSsrRendererProviderName } from "veryfront/extensions";
import extensionPackage from "../deno.json" with { type: "json" };
import { extReactSsr, ReactIsolatedSsrRendererProvider } from "./index.ts";
import {
  resolveReactSsrWorkerModuleUrl,
  resolveReactSsrWorkerReadRootUrl,
} from "./worker-module-url.ts";

Deno.test("ext-react-ssr registers immutable local worker metadata", () => {
  const extension = extReactSsr();
  assertEquals(extension.version, extensionPackage.version);
  let providedName: string | undefined;
  let providedValue: unknown;
  extension.setup?.({
    get: () => undefined,
    require: () => {
      throw new Error("not used");
    },
    provide(name, value) {
      providedName = name;
      providedValue = value;
    },
    config: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
  });

  assertEquals(providedName, IsolatedSsrRendererProviderName);
  assertEquals(providedValue, ReactIsolatedSsrRendererProvider);
  assertEquals(Object.isFrozen(ReactIsolatedSsrRendererProvider), true);
  assertEquals(ReactIsolatedSsrRendererProvider.moduleUrl.startsWith("file:///"), true);
  assertEquals(
    ReactIsolatedSsrRendererProvider.readRootUrls.every((url) => url.startsWith("file:///")),
    true,
  );
});

Deno.test("ext-react-ssr rejects unsupported configuration", () => {
  assertThrows(
    () => extReactSsr({ renderer: "legacy" }),
    TypeError,
    "does not accept configuration properties",
  );
  assertThrows(
    () => extReactSsr(Object.create({ renderer: "inherited" })),
    TypeError,
    "must not inherit configuration",
  );
  assertEquals(extReactSsr({}).name, "ext-react-ssr");
  assertEquals(extReactSsr(Object.create(null)).name, "ext-react-ssr");
});

Deno.test("ext-react-ssr contains hostile configuration inspection failures", () => {
  let trapCalls = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      trapCalls++;
      throw new Error("hostile prototype trap");
    },
  });
  assertThrows(
    () => extReactSsr(hostile),
    TypeError,
    "must not be a proxy",
  );
  assertEquals(trapCalls, 0);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assertThrows(
    () => extReactSsr(revoked.proxy),
    TypeError,
    "must not be a proxy",
  );
});

Deno.test("ext-react-ssr resolves source and emitted worker module siblings", () => {
  assertEquals(
    resolveReactSsrWorkerModuleUrl("file:///opt/ext-react-ssr/src/index.ts"),
    "file:///opt/ext-react-ssr/src/worker-renderer.ts",
  );
  assertEquals(
    resolveReactSsrWorkerModuleUrl("file:///opt/ext-react-ssr/esm/src/index.js"),
    "file:///opt/ext-react-ssr/esm/src/worker-renderer.js",
  );
  assertEquals(
    resolveReactSsrWorkerReadRootUrl("file:///opt/ext-react-ssr/src/index.ts"),
    "file:///opt/ext-react-ssr/src/",
  );
  assertEquals(
    resolveReactSsrWorkerReadRootUrl("file:///opt/ext-react-ssr/esm/src/index.js"),
    "file:///opt/ext-react-ssr/esm/",
  );
  assertEquals(
    new URL(
      "../_dnt.polyfills.js",
      resolveReactSsrWorkerModuleUrl("file:///opt/ext-react-ssr/esm/src/index.js"),
    ).href.startsWith(
      resolveReactSsrWorkerReadRootUrl("file:///opt/ext-react-ssr/esm/src/index.js"),
    ),
    true,
  );
});
