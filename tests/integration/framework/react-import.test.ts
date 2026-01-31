import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { ComponentRegistry } from "@veryfront/modules/component-registry/index.ts";
import { transformImportsWithMap } from "@veryfront/modules/import-map/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";

describe("React Import Tests", () => {
  describe("ComponentRegistry", () => {
    it("should handle React imports in components", async () => {
      await withTestContext("react-import-component", async (context) => {
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
        await mkdir(componentsDir, { recursive: true });

        await writeTextFile(`${componentsDir}/TestComponent.tsx`, testComponentContent);

        const registry = new ComponentRegistry({
          projectDir: context.projectDir,
          adapter: await getAdapter(),
        });
        await registry.discover();

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
        await mkdir(componentsDir, { recursive: true });

        for (const { name, content } of components) {
          await writeTextFile(`${componentsDir}/${name}`, content);
        }

        const registry = new ComponentRegistry({
          projectDir: context.projectDir,
          adapter: await getAdapter(),
        });
        await registry.discover();

        assertEquals(registry.has("Button"), true, "Button component should be discovered");
        assertEquals(registry.has("Card"), true, "Card component should be discovered");

        const [buttonInfo, cardInfo] = await Promise.all([
          registry.loadComponent("Button"),
          registry.loadComponent("Card"),
        ]);

        assertEquals(buttonInfo?.isLoaded, true, "Button should be loaded");
        assertEquals(cardInfo?.isLoaded, true, "Card should be loaded");
      });
    });
  });

  describe("Import Map Loader", () => {
    it("should transform imports with import map", () => {
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

      const importMap = {
        imports: {
          react: "https://esm.sh/react@19.0.0",
          "react-dom": "https://esm.sh/react-dom@19.0.0",
          "react/jsx-runtime": "https://esm.sh/react@19.0.0/jsx-runtime",
        },
      };
      assertExists(importMap.imports, "Import map should have imports");

      const transformed = transformImportsWithMap(testCode, importMap);

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
