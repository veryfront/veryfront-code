import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import factory, { SwcBundler } from "./index.ts";

const logger: ExtensionLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("ext-bundler-swc factory", () => {
  it("registers an explicit SWC Bundler provider", async () => {
    const extension = factory();
    const contracts = new Map<string, unknown>();
    const context: ExtensionContext = {
      config: {},
      logger,
      get: <T>(name: string) => contracts.get(name) as T | undefined,
      require: <T>(name: string) => contracts.get(name) as T,
      provide: <T>(name: string, implementation: T) => {
        contracts.set(name, implementation);
      },
    };

    assertEquals(extension.name, "ext-bundler-swc");
    assertEquals(extension.contracts?.provides, ["Bundler"]);
    await extension.setup?.(context);
    assertInstanceOf(contracts.get("Bundler"), SwcBundler);
    await extension.teardown?.();
  });
});
