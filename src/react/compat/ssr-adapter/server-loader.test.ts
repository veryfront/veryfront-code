import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __setServerModuleLoaderForTests,
  getProjectReact,
  getReactDOMServer,
  type ReactDOMServer,
  resetReactCache,
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
