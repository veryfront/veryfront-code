/**
 * HTTP Bundler Tests
 *
 * Tests for the bundleHttpImports function that processes esm.sh URLs.
 * Focus: Ensuring veryfront module paths are NOT converted to esm.sh URLs.
 */

import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals } from "@veryfront/testing/assert";
import {
  bundleHttpImports,
  hasHttpImports,
} from "../../../src/transforms/esm/http-bundler.ts";

describe("hasHttpImports", () => {
  it("detects https imports", () => {
    const code = `import foo from "https://esm.sh/lodash";`;
    assertEquals(hasHttpImports(code), true);
  });

  it("detects http imports", () => {
    const code = `import foo from "http://example.com/module.js";`;
    assertEquals(hasHttpImports(code), true);
  });

  it("returns false for local imports", () => {
    const code = `import foo from "./local.js";`;
    assertEquals(hasHttpImports(code), false);
  });

  it("returns false for bare specifiers", () => {
    const code = `import React from "react";`;
    assertEquals(hasHttpImports(code), false);
  });

  it("returns false for veryfront module paths", () => {
    const code = `import { Link } from "/_vf_modules/_veryfront/react/router/index.js";`;
    assertEquals(hasHttpImports(code), false);
  });
});

describe("bundleHttpImports - veryfront path exclusion", () => {
  // These tests verify the fix for the bug where /_vf_modules/ paths
  // were incorrectly converted to esm.sh URLs.
  // See: https://github.com/veryfront/veryfront-code/pull/212

  it("does not modify /_vf_modules/ paths", () => {
    const code = `import { Link } from "/_vf_modules/_veryfront/react/router/index.js?ssr=true";`;
    const result = bundleHttpImports(code, "", "test-hash");
    assertEquals(result, code, "/_vf_modules/ paths should remain unchanged");
  });

  it("does not modify /_veryfront/ paths", () => {
    const code = `import { something } from "/_veryfront/utils/index.js";`;
    const result = bundleHttpImports(code, "", "test-hash");
    assertEquals(result, code, "/_veryfront/ paths should remain unchanged");
  });

  it("does not modify nested /_vf_modules/ paths", () => {
    const code = `
import { useRouter } from "/_vf_modules/_veryfront/react/router/index.js?ssr=true";
import { Head } from "/_vf_modules/_veryfront/react/head/index.js?ssr=true";
`.trim();
    const result = bundleHttpImports(code, "", "test-hash");
    assertEquals(result, code, "Multiple /_vf_modules/ imports should remain unchanged");
  });

  it("does not modify protocol-relative paths", () => {
    const code = `import foo from "//cdn.example.com/foo.js";`;
    const result = bundleHttpImports(code, "", "test-hash");
    assertEquals(result, code, "Protocol-relative paths should remain unchanged");
  });

  it("returns code unchanged when no HTTP imports", () => {
    const code = `
import React from "react";
import { useState } from "react";
const x = 1;
`.trim();
    const result = bundleHttpImports(code, "", "test-hash");
    assertEquals(result, code, "Code without HTTP imports should remain unchanged");
  });
});

describe("bundleHttpImports - esm.sh processing", () => {
  // These tests verify esm.sh URLs are properly processed.
  // bundleHttpImports returns Promise<string> when HTTP imports exist.

  it("converts relative esm.sh paths to full URLs", async () => {
    // Code with an HTTP import (to trigger processing) and a relative path
    const code = `
import "https://esm.sh/some-package";
import hoist from "/hoist-non-react-statics@3.3.2";
`.trim();
    const result = await bundleHttpImports(code, "", "test-hash");
    assertEquals(
      result.includes("https://esm.sh/hoist-non-react-statics@3.3.2"),
      true,
      "Relative esm.sh paths should be converted to full URLs",
    );
  });

  it("adds external=react,react-dom to non-React esm.sh URLs", async () => {
    const code = `import lodash from "https://esm.sh/lodash";`;
    const result = await bundleHttpImports(code, "", "test-hash");
    assertEquals(
      typeof result === "string" && result.includes("external=react,react-dom"),
      true,
      "Should add external param for React",
    );
  });

  it("adds target=es2022 to esm.sh URLs without target", async () => {
    const code = `import lodash from "https://esm.sh/lodash";`;
    const result = await bundleHttpImports(code, "", "test-hash");
    assertEquals(
      typeof result === "string" && result.includes("target=es2022"),
      true,
      "Should add target=es2022",
    );
  });

  it("does not add external to React package URLs", async () => {
    const code = `import React from "https://esm.sh/react@19.0.0";`;
    const result = await bundleHttpImports(code, "", "test-hash");
    assertEquals(
      typeof result === "string" && !result.includes("external="),
      true,
      "React package URLs should not have external param",
    );
  });

  it("does not add external to ReactDOM package URLs", async () => {
    const code = `import ReactDOM from "https://esm.sh/react-dom@19.0.0";`;
    const result = await bundleHttpImports(code, "", "test-hash");
    assertEquals(
      typeof result === "string" && !result.includes("external="),
      true,
      "ReactDOM package URLs should not have external param",
    );
  });
});
