import { assertEquals } from "std/assert/mod.ts";
import { getAdapter } from "@veryfront/platform";
import { VirtualModuleSystem } from "../../../src/rendering/virtual-module-system.ts";

Deno.test("VirtualModuleSystem - Register and serve modules", async () => {
  const adapter = await getAdapter();
  const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

  const componentSource = `
import React from 'react';

export default function TestComponent() {
  return React.createElement('div', null, 'Hello from virtual module');
}
`;

  const moduleUrl = await vms.registerModule("test-component", componentSource, "/test/project");

  assertEquals(moduleUrl, "/_veryfront/modules/test-component", "Module URL should be correct");

  const request = new Request("http://localhost:3002/_veryfront/modules/test-component");

  const response = await vms.handleRequest(request);

  assertEquals(response?.status, 200, "Response should be successful");

  const content = await response?.text();
  assertEquals(
    content?.includes("https://esm.sh/react@18.3.1") ||
      content?.includes("https://esm.sh/react@18."),
    true,
    "Module should have transformed React import to default version (18.3.1)",
  );
});

Deno.test("VirtualModuleSystem - Handle non-virtual requests", async () => {
  const adapter = await getAdapter();
  const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

  const request = new Request("http://localhost:3002/some/other/path");
  const response = await vms.handleRequest(request);

  assertEquals(response, null, "Should return null for non-virtual module requests");
});

Deno.test("VirtualModuleSystem - Transform JSX runtime imports", async () => {
  const adapter = await getAdapter();
  const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

  const jsxSource = `
import { jsx, jsxs } from "react/jsx-runtime";
import * as React from "react";

export default function Component() {
  return jsx("div", { children: "Hello" });
}
`;

  const moduleUrl = await vms.registerModule("jsx-component", jsxSource, "/test/project");

  const request = new Request(`http://localhost:3002${moduleUrl}`);
  const response = await vms.handleRequest(request);
  const content = await response?.text();

  assertEquals(
    content?.includes('from "react/jsx-runtime"'),
    true,
    "JSX runtime import should be transformed to ESM URL",
  );
});
