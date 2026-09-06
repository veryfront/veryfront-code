import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "./base.ts";
import { getRuntimeModuleLoader } from "./module-loader.ts";

describe("executor-owned module loader capability", () => {
  it("ignores absent and inherited capabilities", () => {
    assertEquals(getRuntimeModuleLoader(), undefined);
    assertEquals(getRuntimeModuleLoader({} as RuntimeAdapter), undefined);
    assertEquals(getRuntimeModuleLoader({ moduleLoader: undefined } as RuntimeAdapter), undefined);
    assertEquals(getRuntimeModuleLoader(Object.create({ moduleLoader: {} })), undefined);
  });

  it("rejects accessors and proxies without executing their hooks", () => {
    let calls = 0;
    const accessor = Object.defineProperty({}, "moduleLoader", {
      get() {
        calls++;
        return {};
      },
    });
    const proxy = new Proxy({}, {
      getOwnPropertyDescriptor() {
        calls++;
        return undefined;
      },
    });
    const methodAccessor = Object.defineProperty({}, "importModule", {
      get() {
        calls++;
        return () => {};
      },
    });
    for (
      const adapter of [
        accessor,
        proxy,
        { moduleLoader: proxy },
        { moduleLoader: methodAccessor },
        { moduleLoader: null },
        { moduleLoader: Object.create({ importModule() {} }) },
      ]
    ) {
      assertThrows(() => getRuntimeModuleLoader(adapter as RuntimeAdapter), TypeError);
    }
    assertEquals(calls, 0);
  });

  it("captures the method and receiver before use", async () => {
    const expected = {};
    const moduleLoader = {
      importModule() {
        assertStrictEquals(this, moduleLoader);
        return Promise.resolve(expected);
      },
    };
    const adapter = { moduleLoader } as unknown as RuntimeAdapter;
    const captured = getRuntimeModuleLoader(adapter)!;
    moduleLoader.importModule = () => {
      throw new Error("replaced");
    };
    assertStrictEquals(
      await captured.importModule({ kind: "package", specifier: "react" }),
      expected,
    );
  });
});
