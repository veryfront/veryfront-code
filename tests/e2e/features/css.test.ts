#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: CSS Handling
 *
 * Tests CSS functionality:
 * - Inline styles in JSX
 * - CSS imports in pages
 * - Tailwind CSS class processing
 * - CSS bundling and extraction
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: CSS", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("Inline Styles", () => {
    it("should render inline styles in JSX", async () => {
      const projectDir = await createProject(
        "css-inline",
        `
export default function StyledPage() {
  return (
    <div id="styled-content" style={{ color: "red", fontSize: "20px" }}>
      Styled content
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("styled-content")
          .withText("Styled content")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should render complex inline style objects", async () => {
      const projectDir = await createProject(
        "css-inline-complex",
        `
export default function ComplexStylePage() {
  const style = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
    padding: "16px",
    borderRadius: "8px",
  };

  return (
    <div id="complex-styled" style={style}>
      Complex styled content
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("complex-styled")
          .withText("Complex styled content")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("Tailwind CSS Classes", () => {
    it("should render Tailwind utility classes", async () => {
      const projectDir = await createProject(
        "css-tailwind-basic",
        `
export default function TailwindPage() {
  return (
    <div id="tailwind-content" className="p-4 bg-blue-500 text-white rounded-lg">
      Tailwind styled content
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("tailwind-content")
          .withText("Tailwind styled content")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should render responsive Tailwind classes", async () => {
      const projectDir = await createProject(
        "css-tailwind-responsive",
        `
export default function ResponsivePage() {
  return (
    <div id="responsive-content" className="w-full md:w-1/2 lg:w-1/3 p-2 md:p-4 lg:p-8">
      Responsive content
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("responsive-content")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should render Tailwind flexbox and grid classes", async () => {
      const projectDir = await createProject(
        "css-tailwind-layout",
        `
export default function LayoutPage() {
  return (
    <div id="layout-page">
      <div id="flex-container" className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">Item 1</div>
        <div className="flex-1">Item 2</div>
      </div>
      <div id="grid-container" className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4">
        <div>Grid 1</div>
        <div>Grid 2</div>
        <div>Grid 3</div>
      </div>
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("layout-page")
          .withElement("flex-container")
          .withElement("grid-container")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("Dynamic CSS Classes", () => {
    it("should handle conditional class names", async () => {
      const projectDir = await createProject(
        "css-conditional",
        `
export default function ConditionalClassPage() {
  const isActive = true;
  const hasError = false;

  return (
    <div
      id="conditional-content"
      className={\`base-class \${isActive ? 'active' : 'inactive'} \${hasError ? 'error' : ''}\`.trim()}
    >
      Conditional classes
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("conditional-content")
          .withText("Conditional classes")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("Client Components with Styles", () => {
    it("should render client component with dynamic styles", async () => {
      const projectDir = await createProject(
        "css-client-dynamic",
        `
"use client";
import { useState } from "react";

export default function DynamicStylePage() {
  const [color] = useState("blue");

  return (
    <div
      id="dynamic-style-content"
      style={{ color, padding: "10px" }}
      className="border rounded"
    >
      Dynamically styled
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("dynamic-style-content")
          .withText("Dynamically styled")
          .withoutReactErrors();

        expectServer(server).withoutReactErrors();
      });
    });
  });

  describe("CSS with Components", () => {
    it("should render component with styled children", async () => {
      const projectDir = await createProject(
        "css-component-children",
        pages.basic,
        {
          files: {
            "pages/styled-page.tsx": `
import Card from "../components/Card";

export default function StyledPage() {
  return (
    <div id="styled-page">
      <Card title="Test Card">
        <p className="text-gray-600">Card content</p>
      </Card>
    </div>
  );
}
`,
            "components/Card.tsx": `
export default function Card({ title, children }) {
  return (
    <div id="card" className="p-4 border rounded-lg shadow-sm">
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <div id="card-content">{children}</div>
    </div>
  );
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/styled-page");

        expectPage(html, response)
          .toRender()
          .withElement("styled-page")
          .withElement("card")
          .withElement("card-content")
          .withText("Test Card")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("CSS Edge Cases", () => {
    it("should handle empty className gracefully", async () => {
      const projectDir = await createProject(
        "css-empty-classname",
        `
export default function EmptyClassPage() {
  return (
    <div id="empty-class" className="">
      No classes
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("empty-class")
          .withText("No classes")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should handle undefined className gracefully", async () => {
      const projectDir = await createProject(
        "css-undefined-classname",
        `
export default function UndefinedClassPage() {
  const className = undefined;
  return (
    <div id="undefined-class" className={className}>
      Undefined class
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("undefined-class")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should handle style with numeric values", async () => {
      const projectDir = await createProject(
        "css-numeric-styles",
        `
export default function NumericStylePage() {
  return (
    <div
      id="numeric-style"
      style={{
        width: 200,
        height: 100,
        opacity: 0.8,
        zIndex: 10,
        flexGrow: 1
      }}
    >
      Numeric styles
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("numeric-style")
          .withText("Numeric styles")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });
});
