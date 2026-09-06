import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { VeryfrontError } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";
import {
  __setServerModuleLoaderForTests,
  getProjectReact,
  getReactDOMServer,
  type ReactDOMServer,
  resetReactCache,
  resolveSSRRuntime,
} from "./server-loader.ts";

interface ReactMarker {
  version: string;
}

function createServerMarker(version: string): ReactDOMServer & { version: string } {
  return {
    version,
    renderToString: () => version,
    renderToStaticMarkup: () => version,
    renderToPipeableStream: () => ({
      pipe: (writable) => writable,
      abort: () => {},
    }),
    renderToReadableStream: async () => {
      const stream = new ReadableStream<Uint8Array>() as ReadableStream<Uint8Array> & {
        allReady: Promise<void>;
      };
      stream.allReady = Promise.resolve();
      return stream;
    },
  };
}

describe("react/compat/ssr-adapter/server-loader", () => {
  it("rejects invalid explicit server exports with an initialization error", async () => {
    const valid = createServerMarker(React.version);
    for (
      const server of [
        null,
        undefined,
        {},
        { ...valid, renderToString: undefined },
        { ...valid, renderToStaticMarkup: "invalid" },
        { ...valid, renderToReadableStream: true },
        { ...valid, renderToPipeableStream: true },
      ]
    ) {
      const error = await assertRejects(
        () =>
          resolveSSRRuntime({ reactRuntime: { react: React, server: server as ReactDOMServer } }),
        VeryfrontError,
        "invalid render exports",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "initialization-error");
    }
    const server = {
      renderToString: valid.renderToString,
      renderToStaticMarkup: valid.renderToStaticMarkup,
    };
    assertStrictEquals(
      (await resolveSSRRuntime({ reactRuntime: { react: React, server } })).server,
      server,
    );
  });

  it("rejects incomplete prepared server modules before rendering", async () => {
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async () => ({ renderToString: () => "partial" }),
      },
    });
    await assertRejects(
      () => getReactDOMServer(React.version, adapter),
      Error,
      "invalid render exports",
    );
  });
  it("keeps prepared runtimes out of shared version caches", async () => {
    __setServerModuleLoaderForTests(() => Promise.resolve({ default: React }));
    assertStrictEquals(await getProjectReact(React.version), React);
    const references: RuntimeModuleReference[] = [];
    const capturedReact = { ...React };
    const capturedServer = createServerMarker(React.version);
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          references.push(reference);
          if (reference.kind !== "package") throw new Error("Unexpected source load");
          return reference.specifier === "react" ? { default: capturedReact } : capturedServer;
        },
      },
    });
    const selected = await resolveSSRRuntime({ reactVersion: React.version }, adapter);
    assertStrictEquals(selected.react, capturedReact);
    assertStrictEquals(selected.server, capturedServer);
    assertStrictEquals(await getProjectReact(React.version), React);
    assertEquals(
      references.map((reference) => reference.kind === "package" && reference.specifier).sort(),
      ["react", "react-dom/server"],
    );
    await assertRejects(() => getProjectReact("17.0.2", adapter), Error, "React runtime version");
  });

  it("does not recover rejected prepared React imports from the legacy loader", async () => {
    let legacyLoads = 0;
    __setServerModuleLoaderForTests(() => {
      legacyLoads++;
      return Promise.resolve({ default: React });
    });
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async () => {
          throw new Error("module not prepared");
        },
      },
    });
    await assertRejects(
      () => getProjectReact(React.version, adapter),
      Error,
      "module not prepared",
    );
    await assertRejects(
      () => getReactDOMServer(React.version, adapter),
      Error,
      "module not prepared",
    );
    assertEquals(legacyLoads, 0);
  });
  it("accepts equivalent version prefixes without accepting another release", async () => {
    const reactRuntime = { react: React, server: createServerMarker(React.version) };
    for (const prefix of ["v", "^v", "~v"]) {
      const selected = await resolveSSRRuntime({
        reactRuntime,
        reactVersion: prefix + React.version,
      });
      assertStrictEquals(selected.react, React);
      assertStrictEquals(selected.server, reactRuntime.server);
    }
    await assertRejects(
      () =>
        resolveSSRRuntime({
          reactRuntime,
          reactVersion: `v${React.version}-canary`,
        }),
      Error,
      "React runtime version",
    );
  });
  it("rejects missing or non-exact versions on an explicit runtime without guessing a default", async () => {
    for (const version of ["", "latest", undefined]) {
      await assertRejects(
        () =>
          resolveSSRRuntime({
            reactRuntime: {
              react: { ...React, version } as typeof React,
              server: createServerMarker("19.2.4"),
            },
          }),
        Error,
        "React runtime version",
      );
    }
  });
  afterEach(() => {
    resetReactCache();
    __setServerModuleLoaderForTests(null);
  });

  it("isolates React modules by normalized version during concurrent loads", async () => {
    const loadedUrls: string[] = [];
    __setServerModuleLoaderForTests((url) => {
      loadedUrls.push(url);
      const version = url.includes("react@18.3.1") ? "18.3.1" : "19.1.0";
      return Promise.resolve({ default: { version } as ReactMarker });
    });

    const [react18, react19, react18Again] = await Promise.all([
      getProjectReact("18.3.1"),
      getProjectReact("19.1.0"),
      getProjectReact("18.3.1"),
    ]);

    assertEquals(react18.version, "18.3.1");
    assertEquals(react19.version, "19.1.0");
    assertStrictEquals(react18Again, react18);
    assertNotStrictEquals(react18, react19);
    assertEquals(loadedUrls.filter((url) => url.includes("react@18.3.1")).length, 1);
    assertEquals(loadedUrls.filter((url) => url.includes("react@19.1.0")).length, 1);
  });

  it("isolates react-dom/server modules and capabilities by version", async () => {
    __setServerModuleLoaderForTests((url) => {
      const version = url.includes("react-dom@17.0.2") ? "17.0.2" : "19.1.0";
      return Promise.resolve(createServerMarker(version));
    });

    const [server17, server19, server17Again] = await Promise.all([
      getReactDOMServer("17.0.2"),
      getReactDOMServer("19.1.0"),
      getReactDOMServer("17.0.2"),
    ]);

    assertEquals(server17.renderToString(null), "17.0.2");
    assertEquals(server17.renderToPipeableStream, undefined);
    assertEquals(server17.renderToReadableStream, undefined);
    assertEquals(server19.renderToString(null), "19.1.0");
    assertEquals(typeof server19.renderToPipeableStream, "function");
    assertEquals(typeof server19.renderToReadableStream, "function");
    assertStrictEquals(server17Again, server17);
    assertNotStrictEquals(server17, server19);
  });
});
