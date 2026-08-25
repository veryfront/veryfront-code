import "#veryfront/schemas/_test-setup.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { routesCommand } from "./index.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { setLoggerPreset } from "veryfront/utils/logger";
import { type TestContext, withTestContext } from "../../../tests/_helpers/context.ts";

async function setupPagesRouter(context: TestContext): Promise<void> {
  await remove(join(context.projectDir, "app"), { recursive: true });

  await mkdir(join(context.projectDir, "pages", "api"), { recursive: true });

  await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
  await writeTextFile(join(context.projectDir, "pages", "about.mdx"), "# About\n");
  await writeTextFile(
    join(context.projectDir, "pages", "api", "hello.ts"),
    "export const GET=()=>new Response('ok')\n",
  );
}

async function setupAppRouter(context: TestContext): Promise<void> {
  await remove(join(context.projectDir, "pages"), { recursive: true });

  await mkdir(join(context.projectDir, "app", "api", "ag-ui"), { recursive: true });
  await mkdir(join(context.projectDir, "app", "blog", "[slug]"), { recursive: true });

  await writeTextFile(
    join(context.projectDir, "app", "page.tsx"),
    "export default function Home(){return <h1>Home</h1>}\n",
  );
  await writeTextFile(
    join(context.projectDir, "app", "blog", "[slug]", "page.tsx"),
    "export default function Blog(){return <h1>Blog</h1>}\n",
  );
  await writeTextFile(
    join(context.projectDir, "app", "api", "ag-ui", "route.ts"),
    "export const POST=()=>new Response('ok')\n",
  );
}

async function captureConsoleLog(run: () => Promise<void>): Promise<string> {
  const output: string[] = [];
  const origLog = console.log;

  try {
    console.log = (msg?: unknown, ...rest: unknown[]) => {
      output.push(String(msg), ...rest.map(String));
    };
    await run();
  } finally {
    console.log = origLog;
  }

  return output.join("\n");
}

/** Strips SGR colour codes so assertions can look at the raw layout. */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Renders the command through the real CLI logger preset and returns each printed line. */
async function captureCliPresetLines(run: () => Promise<void>): Promise<string[]> {
  setLoggerPreset("cli");
  try {
    const raw = await captureConsoleLog(run);
    return raw.replace(ANSI_SGR, "").split("\n");
  } finally {
    setLoggerPreset("server");
  }
}

describe("CLI routes command", () => {
  it("prints pages and api routes", async () => {
    await withTestContext("routes-print", async (context: TestContext) => {
      await setupPagesRouter(context);

      const text = await captureConsoleLog(async () => {
        await routesCommand(context.projectDir);
      });

      assertStringIncludes(text, "Pages:");
      assertStringIncludes(text, "/ -> pages/index.mdx");
      assertStringIncludes(text, "/about -> pages/about.mdx");
      assertStringIncludes(text, "API:");
      assertStringIncludes(text, "/api/hello");
    });
  });

  it("outputs JSON when requested", async () => {
    await withTestContext("routes-json", async (context: TestContext) => {
      await setupPagesRouter(context);

      setJsonMode(true);
      let text: string;
      try {
        text = await captureConsoleLog(async () => {
          await routesCommand(context.projectDir, { json: true });
        });
      } finally {
        setJsonMode(false);
      }

      const parsed = JSON.parse(text) as {
        pages: Array<{ pattern: string; file: string }>;
        apis: Array<{ pattern: string; file: string }>;
      };

      if (!Array.isArray(parsed.pages) || !Array.isArray(parsed.apis)) {
        throw new Error("invalid json");
      }
    });
  });

  it("prints app router pages and api routes", async () => {
    await withTestContext("routes-app-router", async (context: TestContext) => {
      await setupAppRouter(context);

      const text = await captureConsoleLog(async () => {
        await routesCommand(context.projectDir);
      });

      assertStringIncludes(text, "Pages:");
      assertStringIncludes(text, "/ -> app/page.tsx");
      assertStringIncludes(text, "/blog/[slug] -> app/blog/[slug]/page.tsx");
      assertStringIncludes(text, "API:");
      assertStringIncludes(text, "/api/ag-ui -> app/api/ag-ui/route.ts");
    });
  });

  // Regression: the section break used to be baked into the heading string as
  // "\nAPI:", so the CLI logger prefixed the leading newline instead of the
  // heading. That printed a bare "  ● " line followed by a flush-left "API:".
  it("separates sections without a bare glyph line or an unprefixed heading", async () => {
    await withTestContext("routes-section-layout", async (context: TestContext) => {
      await setupAppRouter(context);

      const lines = await captureCliPresetLines(async () => {
        await routesCommand(context.projectDir);
      });

      const glyphLine = /^ {2}\S /;

      const pagesIndex = lines.findIndex((line) => line.includes("Pages:"));
      const apiIndex = lines.findIndex((line) => line.includes("API:"));

      const pagesHeading = lines[pagesIndex];
      const apiHeading = lines[apiIndex];

      assert(pagesHeading !== undefined, "expected a Pages: heading");
      assert(apiHeading !== undefined, "expected an API: heading");
      assert(
        glyphLine.test(pagesHeading),
        `Pages heading is not indented/prefixed: ${JSON.stringify(pagesHeading)}`,
      );
      assert(
        glyphLine.test(apiHeading),
        `API heading is not indented/prefixed: ${JSON.stringify(apiHeading)}`,
      );

      // The blank separator is the other half of the fix: without it the two
      // sections run together. Assert it explicitly so removing the
      // `console.log("")` fails here rather than passing silently.
      assert(apiIndex > pagesIndex, "expected the API section to follow the Pages section");
      assert(
        lines[apiIndex - 1] === "",
        `expected a blank line before the API heading, got ${JSON.stringify(lines[apiIndex - 1])}`,
      );

      for (const line of lines) {
        if (line.trim() === "") continue;
        assert(
          !(glyphLine.test(line) && line.replace(glyphLine, "").trim() === ""),
          `emitted a glyph-only line with no content: ${JSON.stringify(line)}`,
        );
      }
    });
  });
});
