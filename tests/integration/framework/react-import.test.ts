import * as React from "react";
void React;
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { denoAdapter } from "@veryfront/platform/adapters/runtime/deno/index.ts";
import { ComponentRegistry } from "@veryfront/modules/component-registry/index.ts";
import { loadImportMap, transformImportsWithMap } from "@veryfront/modules/import-map/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("React Import Tests", () => {
  describe("ComponentRegistry", () => {
    it("should handle React imports in components", async () => {
      await withTestContext("react-import-component", async (context) => {
        // Create a test component with React import
        const testComponentContent = `
import React from 'react';

export default function TestComponent() {
  const [count, setCount] = React.useState(0);

  return React.createElement('div', null,
    React.createElement('button', {
      onClick: () => setCount(count + 1)
    }, 'Count: ' + count));
}
`;

        const componentsDir = `${context.projectDir}/components`;
        await Deno.mkdir(componentsDir, { recursive: true });
        const componentPath = `${componentsDir}/TestComponent.tsx`;

        // Write the test component
        await Deno.writeTextFile(componentPath, testComponentContent);

        // Test component registry
        const registry = new ComponentRegistry({
          projectDir: context.projectDir,
          adapter: denoAdapter,
        });
        await registry.discover();

        // Check if component was loaded
        const componentInfo = await registry.loadComponent("TestComponent");
        assertEquals(componentInfo !== null, true, "Component should be discovered");
        assertEquals(componentInfo?.isLoaded, true, "Component should be loaded");
        assertEquals(
          componentInfo?.content?.includes("TestComponent"),
          true,
          "Component content should be loaded",
        );
      });
    });

    it("should handle multiple React components", async () => {
      await withTestContext("react-import-multiple", async (context) => {
        // Create multiple test components
        const components = [
          {
            name: "Button.tsx",
            content: `
import React from 'react';

export default function Button({ children, onClick }) {
  return React.createElement('button', { onClick }, children);
}
`,
          },
          {
            name: "Card.tsx",
            content: `
import React from 'react';

export default function Card({ title, children }) {
  return React.createElement('div', { className: 'card' },
    React.createElement('h2', null, title),
    children);
}
`,
          },
        ];

        const componentsDir = `${context.projectDir}/components`;
        await Deno.mkdir(componentsDir, { recursive: true });

        // Write all components
        for (const comp of components) {
          await Deno.writeTextFile(`${componentsDir}/${comp.name}`, comp.content);
        }

        // Load components
        const registry = new ComponentRegistry({
          projectDir: context.projectDir,
          adapter: denoAdapter,
        });
        await registry.discover();

        // Verify all components discovered
        assertEquals(registry.has("Button"), true, "Button component should be discovered");
        assertEquals(registry.has("Card"), true, "Card component should be discovered");

        // Load and verify components
        const buttonInfo = await registry.loadComponent("Button");
        const cardInfo = await registry.loadComponent("Card");

        assertEquals(buttonInfo?.isLoaded, true, "Button should be loaded");
        assertEquals(cardInfo?.isLoaded, true, "Card should be loaded");
      });
    });
  });

  describe("Import Map Loader", () => {
    it("should transform imports with import map", async () => {
      await withTestContext("react-import-transform", async (_context) => {
        // Test code with various import patterns
        const testCode = `
import React from 'react';
import { useState, useEffect } from 'react';
import * as ReactDOM from 'react-dom';
import { jsx } from 'react/jsx-runtime';
export { Fragment } from 'react';

const MyComponent = () => {
  return React.createElement('div', null, 'Hello');
};
`;

        // Load import map
        const importMap = await loadImportMap(Deno.cwd());
        assertExists(importMap.imports, "Import map should have imports");

        // Transform the code
        const transformed = transformImportsWithMap(testCode, importMap);

        // Verify React imports are left as bare imports (managed by import map)
        assertEquals(
          transformed.includes('from "react"'),
          true,
          "React bare import should be preserved",
        );

        assertEquals(
          transformed.includes('from "react/jsx-runtime"'),
          true,
          "React JSX runtime bare import should be preserved",
        );
      });
    });
  });
});
