import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors/index.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ClientPageIslandLayout,
  hasUseClientDirective,
  hasUseServerDirective,
  planClientPageIsland,
} from "./page-island.ts";

const PROJECT_DIR = "/project";
const APP_DIR = "app";
const PAGE_PATH = "/project/app/page.tsx";
const CLIENT_PAGE_SOURCE = `'use client';\nexport default function Page() { return null; }`;

function createMockFs(
  files: ReadonlyMap<string, string>,
  readFailures: ReadonlySet<string> = new Set(),
): FileSystemAdapter {
  return {
    readFile(path: string): Promise<string> {
      if (readFailures.has(path)) return Promise.reject(new Error(`Read failed: ${path}`));

      const source = files.get(path);
      return source === undefined
        ? Promise.reject(new Error(`File not found: ${path}`))
        : Promise.resolve(source);
    },
  } as FileSystemAdapter;
}

function layout(path: string, kind: ClientPageIslandLayout["kind"] = "tsx") {
  return { kind, path } satisfies ClientPageIslandLayout;
}

function createOptions(
  layouts: readonly ClientPageIslandLayout[],
  fs: FileSystemAdapter | null = createMockFs(new Map()),
) {
  return {
    pageSource: CLIENT_PAGE_SOURCE,
    pagePath: PAGE_PATH,
    projectDir: PROJECT_DIR,
    appDir: APP_DIR,
    layouts,
    fs,
    strategy: "rsc-module" as const,
  };
}

describe("rendering/rsc/page-island", () => {
  it("recognizes use client within a directive prologue after leading trivia", () => {
    const source =
      `\uFEFF#!/usr/bin/env -S deno run\n/* license */\n\"use strict\"\n// boundary\n'use client'\nexport default null;`;

    assertEquals(hasUseClientDirective(source), true);
  });

  it("does not recognize use client after an import", () => {
    const source = `import \"./setup.ts\";\n'use client';\nexport default null;`;

    assertEquals(hasUseClientDirective(source), false);
  });

  it("does not recognize use client inside comments", () => {
    const source = `/*\n'use client';\n*/\nexport default null;`;

    assertEquals(hasUseClientDirective(source), false);
  });

  it("does not recognize use client inside template literals", () => {
    const source = ["const marker = `", "'use client';", "`;", "export default null;"].join(
      "\n",
    );

    assertEquals(hasUseClientDirective(source), false);
  });

  it("does not recognize use client after another statement", () => {
    const source = `const initialized = true;\n'use client';\nexport default null;`;

    assertEquals(hasUseClientDirective(source), false);
  });

  it("recognizes use server only within the directive prologue", () => {
    assertEquals(
      hasUseServerDirective(
        `/* license */\n"use strict";\n'use server';\nexport const action = true;`,
      ),
      true,
    );
    assertEquals(
      hasUseServerDirective(
        `import "./setup.ts";\n'use server';\nexport const action = true;`,
      ),
      false,
    );
  });

  it("retains the client file naming convention", () => {
    assertEquals(hasUseClientDirective("export default null;", "/app/page.client.tsx"), true);
    assertEquals(hasUseClientDirective("export default null;", "/app/page.tsx"), false);
  });

  it("does not inherit the client naming convention from a directory", () => {
    assertEquals(
      hasUseClientDirective("export default null;", "/app/server.client.assets/page.tsx"),
      false,
    );
  });

  it("partitions root-to-leaf server, server, client, client layouts", async () => {
    const layouts = [
      layout("/project/app/layout.tsx"),
      layout("/project/app/docs/layout.mdx", "mdx"),
      layout("/project/app/docs/api/layout.tsx"),
      layout("/project/app/docs/api/v2/layout.client.tsx"),
    ];
    const fs = createMockFs(
      new Map([
        [layouts[0]!.path, "export default function RootLayout() {}"],
        [layouts[2]!.path, `'use client';\nexport default function ApiLayout() {}`],
        [layouts[3]!.path, "export default function VersionLayout() {}"],
      ]),
    );

    const result = await planClientPageIsland(createOptions(layouts, fs));

    assertEquals(result, {
      serverLayouts: layouts.slice(0, 2),
      clientLayouts: layouts.slice(2),
    });
  });

  it("keeps all-server layouts outside the client island", async () => {
    const layouts = [
      layout("/project/app/layout.tsx"),
      layout("/project/app/docs/layout.tsx"),
    ];
    const fs = createMockFs(new Map(layouts.map(({ path }) => [path, "export default null;"])));

    const result = await planClientPageIsland(createOptions(layouts, fs));

    assertEquals(result, { serverLayouts: layouts, clientLayouts: [] });
  });

  it("keeps all-client layouts inside the client island", async () => {
    const layouts = [
      layout("/project/app/layout.client.tsx"),
      layout("/project/app/docs/layout.tsx"),
    ];
    const fs = createMockFs(
      new Map([
        [layouts[0]!.path, "export default null;"],
        [layouts[1]!.path, `'use client';\nexport default null;`],
      ]),
    );

    const result = await planClientPageIsland(createOptions(layouts, fs));

    assertEquals(result, { serverLayouts: [], clientLayouts: layouts });
  });

  it("classifies missing and unreadable layouts as server layouts", async () => {
    const layouts = [
      layout("/project/app/layout.tsx"),
      layout("/project/app/docs/layout.tsx"),
    ];
    const fs = createMockFs(new Map(), new Set([layouts[1]!.path]));

    const result = await planClientPageIsland(createOptions(layouts, fs));

    assertEquals(result, { serverLayouts: layouts, clientLayouts: [] });
  });

  it("returns null outside the remote App Router client-page case", async () => {
    const fs = createMockFs(new Map());
    const base = createOptions([], fs);

    assertEquals(
      await planClientPageIsland({ ...base, pageSource: "export default null;" }),
      null,
    );
    assertEquals(
      await planClientPageIsland({ ...base, pagePath: "/project/pages/index.tsx" }),
      null,
    );
    assertEquals(await planClientPageIsland({ ...base, fs: null }), null);
    assertEquals(await planClientPageIsland({ ...base, strategy: "fs" }), null);
  });

  it("rejects a server layout below a client layout", async () => {
    const layouts = [
      layout("/project/app/layout.tsx"),
      layout("/project/app/docs/layout.tsx"),
      layout("/project/app/docs/api/layout.client.tsx"),
    ];
    const fs = createMockFs(
      new Map([
        [layouts[0]!.path, `'use client';\nexport default null;`],
        [layouts[1]!.path, "export default null;"],
        [layouts[2]!.path, "export default null;"],
      ]),
    );

    const error = await assertRejects(
      () => planClientPageIsland(createOptions(layouts, fs)),
      VeryfrontError,
    ) as VeryfrontError;

    assertEquals(error.slug, "client-boundary-violation");
  });
});
