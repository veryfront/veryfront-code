import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { analyzeComponent, buildClientManifest } from "./component-analyzer.ts";

function createMockFs(files: Map<string, string>): FileSystemAdapter {
  const readFile = (path: string): Promise<string> => {
    const content = files.get(path);
    if (content === undefined) {
      return Promise.reject(new Error(`File not found: ${path}`));
    }
    return Promise.resolve(content);
  };

  return {
    readFile,
    writeFile: () => Promise.resolve(),
    exists: (path: string) => Promise.resolve(files.has(path)),
    stat: () => Promise.resolve({ isFile: true, isDirectory: false }),
    readDir: () => (async function* (): AsyncGenerator<never> {})(),
    remove: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  } as unknown as FileSystemAdapter;
}

describe("rendering/rsc/component-analyzer", () => {
  describe("analyzeComponent", () => {
    it("should detect 'use client' directive with double quotes", async () => {
      const fs = createMockFs(
        new Map([
          [
            "/project/app/Button.tsx",
            `"use client";\nexport default function Button() { return <button/>; }`,
          ],
        ]),
      );

      const result = await analyzeComponent("/project/app/Button.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, true);
      assertEquals(result.hasUseServer, false);
    });

    it("should detect 'use client' directive with single quotes", async () => {
      const fs = createMockFs(
        new Map([
          ["/project/app/Button.tsx", `'use client';\nexport default function Button() {}`],
        ]),
      );

      const result = await analyzeComponent("/project/app/Button.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, true);
    });

    it("does not classify a directive after an import as client", async () => {
      const path = "/project/app/LateDirective.tsx";
      const fs = createMockFs(
        new Map([[path, `import \"./setup.ts\";\n'use client';\nexport default null;`]]),
      );

      const result = await analyzeComponent(path, fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseClient, false);
    });

    it("does not classify a directive-like comment as client", async () => {
      const path = "/project/app/Comment.tsx";
      const fs = createMockFs(
        new Map([[path, `/*\n'use client';\n*/\nexport default null;`]]),
      );

      const result = await analyzeComponent(path, fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseClient, false);
    });

    it("does not classify a directive-like template literal as client", async () => {
      const path = "/project/app/Template.tsx";
      const source = [
        "const marker = `",
        "'use client';",
        "`;",
        "export default null;",
      ].join("\n");
      const fs = createMockFs(
        new Map([[path, source]]),
      );

      const result = await analyzeComponent(path, fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseClient, false);
    });

    it("should detect 'use server' directive", async () => {
      const fs = createMockFs(
        new Map([
          ["/project/app/action.ts", `"use server";\nexport async function doStuff() {}`],
        ]),
      );

      const result = await analyzeComponent("/project/app/action.ts", fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseServer, true);
      assertEquals(result.hasUseClient, false);
    });

    it("should classify .client. files as client components", async () => {
      const fs = createMockFs(
        new Map([["/project/app/Counter.client.tsx", `export default function Counter() {}`]]),
      );

      const result = await analyzeComponent("/project/app/Counter.client.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, false);
    });

    it("does not classify files as client from a parent directory name", async () => {
      const path = "/project/app/server.client.assets/Counter.tsx";
      const fs = createMockFs(
        new Map([[path, `export default function Counter() {}`]]),
      );

      const result = await analyzeComponent(path, fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseClient, false);
    });

    it("should classify files without directives or .client. as server", async () => {
      const fs = createMockFs(
        new Map([["/project/app/Header.tsx", `export default function Header() {}`]]),
      );

      const result = await analyzeComponent("/project/app/Header.tsx", fs);

      assertEquals(result.type, "server");
      assertEquals(result.hasUseClient, false);
      assertEquals(result.hasUseServer, false);
    });

    it("should generate a PascalCase component ID from file name", async () => {
      const fs = createMockFs(
        new Map([["/project/app/my-component.tsx", `export default function MyComponent() {}`]]),
      );

      const result = await analyzeComponent("/project/app/my-component.tsx", fs);

      assertEquals(result.id, "MyComponent");
    });

    it("should use parent directory name for index files", async () => {
      const fs = createMockFs(
        new Map([["/project/app/sidebar/index.tsx", `export default function Sidebar() {}`]]),
      );

      const result = await analyzeComponent("/project/app/sidebar/index.tsx", fs);

      assertEquals(result.id, "Sidebar");
    });

    it("should extract export names from the file content", async () => {
      const fs = createMockFs(
        new Map([
          ["/project/app/utils.ts", `export function helper() {}\nexport const VALUE = 42;`],
        ]),
      );

      const result = await analyzeComponent("/project/app/utils.ts", fs);

      assertEquals(result.exports.includes("helper"), true);
      assertEquals(result.exports.includes("VALUE"), true);
    });

    it("should set filePath from the provided path", async () => {
      const fs = createMockFs(
        new Map([["/project/app/Widget.tsx", `export default function Widget() {}`]]),
      );

      const result = await analyzeComponent("/project/app/Widget.tsx", fs);

      assertEquals(result.filePath, "/project/app/Widget.tsx");
    });

    it("changes the client module content version when source changes", async () => {
      const path = "/project/app/Widget.tsx";
      const first = await analyzeComponent(
        path,
        createMockFs(new Map([[path, `'use client';\nexport const value = 1;`]])),
      );
      const second = await analyzeComponent(
        path,
        createMockFs(new Map([[path, `'use client';\nexport const value = 2;`]])),
      );

      assertEquals(typeof first.contentHash, "string");
      assertEquals(first.contentHash === second.contentHash, false);
    });

    it("should handle file with both use client and use server directives", async () => {
      const fs = createMockFs(
        new Map([
          [
            "/project/app/Mixed.tsx",
            `"use client";\n"use server";\nexport default function Mixed() {}`,
          ],
        ]),
      );

      const result = await analyzeComponent("/project/app/Mixed.tsx", fs);

      assertEquals(result.type, "client");
      assertEquals(result.hasUseClient, true);
      assertEquals(result.hasUseServer, true);
    });

    it("should strip .client and .server suffixes from component ID", async () => {
      const fs = createMockFs(
        new Map([["/project/app/Button.client.tsx", `export default function Button() {}`]]),
      );

      const result = await analyzeComponent("/project/app/Button.client.tsx", fs);

      assertEquals(result.id, "Button");
    });

    it("should handle underscore-separated file names for PascalCase", async () => {
      const fs = createMockFs(
        new Map([["/project/app/my_widget_component.tsx", `export default function Comp() {}`]]),
      );

      const result = await analyzeComponent("/project/app/my_widget_component.tsx", fs);

      assertEquals(result.id, "MyWidgetComponent");
    });
  });

  describe("buildClientManifest", () => {
    it("fails explicitly when different paths produce the same component ID", async () => {
      const files = new Map([
        [
          "/project/app/admin/Button.tsx",
          `'use client';\nexport default function Button() { return null; }`,
        ],
        [
          "/project/app/shop/Button.tsx",
          `'use client';\nexport default function Button() { return null; }`,
        ],
      ]);
      const fs = createMockFs(files);
      fs.readDir = (path: string) =>
        (async function* () {
          if (path === "/project/app") {
            yield { name: "admin", isFile: false, isDirectory: true, isSymlink: false };
            yield { name: "shop", isFile: false, isDirectory: true, isSymlink: false };
            return;
          }
          if (path === "/project/app/admin" || path === "/project/app/shop") {
            yield { name: "Button.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        })();

      await assertRejects(
        () => buildClientManifest("/project", "app", fs),
        Error,
        'Duplicate client component ID "Button"',
      );
    });
  });
});
