import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DISCOVERY_GLOBAL_VERYFRONT_MODULES } from "./import-rewriter.ts";
import "./runtime-modules-bootstrap.ts";
import {
  getDiscoveryRuntimeModules,
  installDiscoveryRuntimeModulesGlobal,
} from "./runtime-modules.ts";

describe("compiled discovery runtime modules", () => {
  it("registers every module rewritten to a compiled-binary global", () => {
    const modules = getDiscoveryRuntimeModules();

    assertEquals(Object.keys(modules).sort(), [...DISCOVERY_GLOBAL_VERYFRONT_MODULES].sort());
    assertEquals(
      typeof (modules["veryfront/agent"] as { agent?: unknown }).agent,
      "function",
    );
    assertEquals(
      typeof (modules["veryfront/eval"] as { evalAgent?: unknown }).evalAgent,
      "function",
    );
    assertEquals(
      typeof (modules["veryfront/embedding"] as { createUploadHandler?: unknown })
        .createUploadHandler,
      "function",
    );
  });

  it("exposes an immutable compiled module registry", () => {
    const modules = getDiscoveryRuntimeModules();

    assertThrows(
      () => {
        (modules as Record<string, unknown>)["veryfront/tool"] = null;
      },
      TypeError,
    );
  });

  it("installs the compiled module registry as an immutable hidden global", () => {
    const modules = getDiscoveryRuntimeModules();
    installDiscoveryRuntimeModulesGlobal();

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__VERYFRONT_MODULES__");
    assertEquals(descriptor?.value, modules);
    assertEquals(descriptor?.writable, false);
    assertEquals(descriptor?.configurable, false);
    assertEquals(descriptor?.enumerable, false);
  });
});
