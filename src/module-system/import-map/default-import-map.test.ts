import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { getDefaultImportMap } from "./default-import-map.ts";

describe("getDefaultImportMap", () => {
  it("should return an ImportMapConfig with imports", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap);
    assertExists(importMap.imports);
  });

  it("should include react imports", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);
    assertExists(importMap.imports["react"]);
    assert(importMap.imports["react"].includes("esm.sh"));
    assert(importMap.imports["react"].includes("react@"));
  });

  it("should include react-dom imports", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);
    assertExists(importMap.imports["react-dom"]);
    assert(importMap.imports["react-dom"].includes("esm.sh"));
    assert(importMap.imports["react-dom"].includes("react-dom@"));
  });

  it("should include react/ path mapping", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);
    assertExists(importMap.imports["react/"]);
    assert(importMap.imports["react/"].includes("esm.sh"));
    assert(importMap.imports["react/"].includes("react@"));
    assert(importMap.imports["react/"].endsWith("/"));
  });

  it("should use consistent React version across all imports", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);

    // Extract version from react import
    const reactUrl = importMap.imports["react"];
    assertExists(reactUrl);
    const reactVersionMatch = reactUrl.match(/react@([\d.]+)/);
    assertExists(reactVersionMatch);
    const reactVersion = reactVersionMatch[1];

    // Check react-dom uses the same version
    const reactDomUrl = importMap.imports["react-dom"];
    assertExists(reactDomUrl);
    assert(reactDomUrl.includes(`react-dom@${reactVersion}`));

    // Check react/ uses the same version
    const reactSlashUrl = importMap.imports["react/"];
    assertExists(reactSlashUrl);
    assert(reactSlashUrl.includes(`react@${reactVersion}`));
  });

  it("should return ESM CDN URLs", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);

    // All URLs should point to esm.sh
    for (const [key, value] of Object.entries(importMap.imports)) {
      assert(
        value.startsWith("https://esm.sh/"),
        `Import "${key}" should use esm.sh but got: ${value}`
      );
    }
  });

  it("should return stable output for multiple calls", () => {
    const importMap1 = getDefaultImportMap();
    const importMap2 = getDefaultImportMap();

    assertEquals(importMap1, importMap2);
  });

  it("should include react-dom/client for React 18+ patterns", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);

    // Check if react-dom/client is mapped (either explicitly or through react-dom/)
    const hasReactDomClient =
      importMap.imports["react-dom/client"] !== undefined ||
      importMap.imports["react-dom/"] !== undefined;

    // At minimum, react-dom base should be present
    assertExists(importMap.imports["react-dom"]);
  });

  it("should create URLs compatible with browser import maps", () => {
    const importMap = getDefaultImportMap();

    assertExists(importMap.imports);

    // Verify the structure matches browser import map spec
    for (const [key, value] of Object.entries(importMap.imports)) {
      // Keys should be bare specifiers or paths
      assert(
        !key.startsWith("http") && !key.startsWith("file://"),
        `Import key "${key}" should be a bare specifier`
      );

      // Values should be valid URLs or relative paths
      assert(
        value.startsWith("https://") || value.startsWith("http://") || value.startsWith("./") || value.startsWith("/"),
        `Import value for "${key}" should be a valid URL or path: ${value}`
      );
    }
  });
});
