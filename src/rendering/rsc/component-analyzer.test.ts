import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { analyzeComponent } from "./component-analyzer.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

/** Create a mock file system adapter that reads from a Map */
function createMockFs(files: Map<string, string>): FileSystemAdapter {
  return {
    readFile: (path: string) => {
      const content = files.get(path);
      if (content === undefined) return Promise.reject(new Error(`File not found: ${path}`));
      return Promise.resolve(content);
    },
    writeFile: () => Promise.resolve(),
    exists: (path: string) => Promise.resolve(files.has(path)),
    stat: () => Promise.resolve({ isFile: true, isDirectory: false }),
    readDir: () => (async function* () {})(),
    remove: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  } as unknown as FileSystemAdapter;
}

describe("rendering/rsc/component-analyzer", () => {
  describe("analyzeComponent", () => {
    it("should detect 'use client' directive with double quotes", async () => {
      const files = new Map([
        [
          "/project/app/Button.tsx",
          `"use client";\nexport default function Button() { return <button/>; }`,
        ],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Button.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, true);
      assertEquals(result.hasUseServer, false);
    });

    it("should detect 'use client' directive with single quotes", async () => {
      const files = new Map([
        ["/project/app/Button.tsx", `'use client';\nexport default function Button() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Button.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, true);
    });

    it("should detect 'use server' directive", async () => {
      const files = new Map([
        ["/project/app/action.ts", `"use server";\nexport async function doStuff() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/action.ts", fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseServer, true);
      assertEquals(result.hasUseClient, false);
    });

    it("should classify .client. files as client components", async () => {
      const files = new Map([
        ["/project/app/Counter.client.tsx", `export default function Counter() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Counter.client.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, false);
    });

    it("should classify files without directives or .client. as server", async () => {
      const files = new Map([
        ["/project/app/Header.tsx", `export default function Header() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Header.tsx", fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseClient, false);
      assertEquals(result.hasUseServer, false);
    });

    it("should generate a PascalCase component ID from file name", async () => {
      const files = new Map([
        ["/project/app/my-component.tsx", `export default function MyComponent() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/my-component.tsx", fs);

      assertEquals(result.id, "MyComponent");
    });

    it("should use parent directory name for index files", async () => {
      const files = new Map([
        ["/project/app/sidebar/index.tsx", `export default function Sidebar() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/sidebar/index.tsx", fs);

      assertEquals(result.id, "Sidebar");
    });

    it("should extract export names from the file content", async () => {
      const files = new Map([
        ["/project/app/utils.ts", `export function helper() {}\nexport const VALUE = 42;`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/utils.ts", fs);

      assertEquals(result.exports.includes("helper"), true);
      assertEquals(result.exports.includes("VALUE"), true);
    });

    it("should set filePath from the provided path", async () => {
      const files = new Map([
        ["/project/app/Widget.tsx", `export default function Widget() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Widget.tsx", fs);

      assertEquals(result.filePath, "/project/app/Widget.tsx");
    });

    it("should handle file with both use client and use server directives", async () => {
      const files = new Map([
        [
          "/project/app/Mixed.tsx",
          `"use client";\n"use server";\nexport default function Mixed() {}`,
        ],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Mixed.tsx", fs);

      // use client takes precedence
      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, true);
      assertEquals(result.hasUseServer, true);
    });

    it("should strip .client and .server suffixes from component ID", async () => {
      const files = new Map([
        ["/project/app/Button.client.tsx", `export default function Button() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/Button.client.tsx", fs);

      // The extension is stripped first (.tsx), then .client suffix
      assertEquals(result.id, "Button");
    });

    it("should handle underscore-separated file names for PascalCase", async () => {
      const files = new Map([
        ["/project/app/my_widget_component.tsx", `export default function Comp() {}`],
      ]);
      const fs = createMockFs(files);
      const result = await analyzeComponent("/project/app/my_widget_component.tsx", fs);

      assertEquals(result.id, "MyWidgetComponent");
    });
  });
});
