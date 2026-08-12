import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";

import { MINIMUM_NODE_VERSION } from "../scripts/build/runtime-support.ts";
import {
  formatUnsupportedNodeMessage,
  meetsMinimumNodeVersion,
  MINIMUM_NODE_VERSION as SHIM_MINIMUM_NODE_VERSION,
} from "../scripts/build/node-engine-precondition.js";

const wrapperSource = await Deno.readTextFile(
  new URL("../scripts/build/bin-wrapper.js", import.meta.url),
);

describe("node engine precondition", () => {
  it("keeps the shim floor locked to the single runtime-version contract", () => {
    assertEquals(SHIM_MINIMUM_NODE_VERSION, MINIMUM_NODE_VERSION);
  });

  it("rejects Node releases below the floor", () => {
    // 18.18.0 is the release dogfooded in the report: it predates
    // process.getBuiltinModule (Node 22.3.0), which the compat layer requires.
    assertEquals(meetsMinimumNodeVersion("18.18.0"), false);
    assertEquals(meetsMinimumNodeVersion("20.11.1"), false);
    assertEquals(meetsMinimumNodeVersion("22.2.0"), false);
    assertEquals(meetsMinimumNodeVersion("22.2.99"), false);
  });

  it("accepts the floor and newer Node releases", () => {
    assertEquals(meetsMinimumNodeVersion("22.3.0"), true);
    assertEquals(meetsMinimumNodeVersion("22.10.0"), true);
    assertEquals(meetsMinimumNodeVersion("24.0.0"), true);
    assertEquals(meetsMinimumNodeVersion("25.2.1"), true);
  });

  it("compares version segments numerically, not lexicographically", () => {
    assertEquals(meetsMinimumNodeVersion("9.0.0"), false);
    assertEquals(meetsMinimumNodeVersion("100.0.0"), true);
  });

  it("fails open when the version is not a plain release triple", () => {
    // The gate only exists to explain a crash. It must never be the reason a
    // runtime that would have worked is refused, so anything it cannot parse
    // with confidence is allowed through to the normal startup path.
    assertEquals(meetsMinimumNodeVersion(undefined), true);
    assertEquals(meetsMinimumNodeVersion(""), true);
    assertEquals(meetsMinimumNodeVersion("not-a-version"), true);
    assertEquals(meetsMinimumNodeVersion("22.3.0-nightly20240604"), true);
  });

  it("classifies the failure with the required version, the actual version, a fix and docs", () => {
    const message = formatUnsupportedNodeMessage("18.18.0");

    assertStringIncludes(message, "✗");
    assertStringIncludes(message, `Veryfront requires Node.js ${MINIMUM_NODE_VERSION} or later`);
    assertStringIncludes(message, "18.18.0");
    assertStringIncludes(message, "Suggestion:");
    assertStringIncludes(
      message,
      "https://veryfront.com/docs/code/getting-started/installation",
    );
  });

  it("never leaks the raw compat assertion users cannot act on", () => {
    const message = formatUnsupportedNodeMessage("18.18.0");
    assertEquals(message.includes("node:util/types"), false);
    assertEquals(message.includes("ModuleJob"), false);
  });
});

describe("bin wrapper", () => {
  const gateIndex = wrapperSource.indexOf("if (!meetsMinimumNodeVersion(");
  const fallbackIndex = wrapperSource.indexOf("async function runJsFallback");
  const cliImportIndex = wrapperSource.indexOf("../esm/cli/main.js");
  const nativeSpawnIndex = wrapperSource.indexOf("spawn(nativeBinary");

  it("gates before the bundled JS CLI loads", () => {
    assert(gateIndex >= 0, "bin-wrapper.js must run the Node engine precondition");
    assert(cliImportIndex >= 0, "bin-wrapper.js must still import the bundled CLI");
    assert(
      gateIndex < cliImportIndex,
      "the engine gate must run before the framework module graph loads, " +
        "otherwise the compat assertion throws first",
    );
  });

  it("keeps the gate inside the JS fallback so the native binary stays ungated", () => {
    // The postinstall-downloaded native binary is self-contained and runs fine
    // on Node releases below the floor. Hoisting this gate to module scope
    // would refuse those installs for no reason.
    assert(nativeSpawnIndex >= 0, "bin-wrapper.js must still spawn the native binary");
    assert(
      fallbackIndex >= 0 && gateIndex > fallbackIndex,
      "the engine gate must live inside runJsFallback, not at module scope",
    );
  });

  it("exits non-zero on an unsupported runtime", () => {
    assertStringIncludes(wrapperSource, "process.exit(1)");
  });
});
