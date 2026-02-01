import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getAdapter } from "#veryfront/platform";
import { VirtualModuleSystem } from "../../../src/rendering/virtual-module-system.ts";

describe(
  "VirtualModuleSystem Smoke Tests",
  {
    sanitizeOps: false,
    sanitizeResources: false,
  },
  () => {
    it("should register and serve modules", async () => {
      const adapter = await getAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

      const componentSource = `
import React from 'react';

export default function TestComponent() {
  return React.createElement('div', null, 'Hello from virtual module');
}
`;

      const moduleUrl = await vms.registerModule(
        "test-component",
        componentSource,
        "/test/project",
      );

      assertEquals(
        moduleUrl,
        "/_veryfront/modules/test-component",
        "Module URL should be correct",
      );

      const request = new Request(
        "http://localhost:3002/_veryfront/modules/test-component",
      );

      const response = await vms.handleRequest(request);

      assertEquals(response?.status, 200, "Response should be successful");

      const content = await response?.text();

      assertStringIncludes(
        content ?? "",
        "https://esm.sh/react@",
        "Module should have transformed React import to esm.sh URL",
      );
    });

    it("should handle non-virtual requests", async () => {
      const adapter = await getAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

      const request = new Request("http://localhost:3002/some/other/path");
      const response = await vms.handleRequest(request);

      assertEquals(
        response,
        null,
        "Should return null for non-virtual module requests",
      );
    });

    it("should transform JSX runtime imports", async () => {
      const adapter = await getAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

      const jsxSource = `
import { jsx, jsxs } from "react/jsx-runtime";
import * as React from "react";

export default function Component() {
  return jsx("div", { children: "Hello" });
}
`;

      const moduleUrl = await vms.registerModule(
        "jsx-component",
        jsxSource,
        "/test/project",
      );

      const request = new Request(`http://localhost:3002${moduleUrl}`);
      const response = await vms.handleRequest(request);
      const content = await response?.text();

      assertStringIncludes(
        content ?? "",
        "https://esm.sh/react@",
        "React import should use esm.sh URL",
      );
      assertStringIncludes(content ?? "", "jsx-runtime", "Should include jsx-runtime path");
    });
  },
);
