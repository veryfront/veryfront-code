import "#veryfront/schemas/_test-setup.ts";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { routesCommand } from "./index.ts";
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

/**
 * Extract JSON object from captured output that may contain log messages.
 * Looks for valid JSON containing "pages" and "apis" keys.
 */
function extractJson(text: string): string {
  // Look for JSON that starts with { and contains "pages"
  const lines = text.split("\n");
  let jsonStart = -1;
  let braceCount = 0;
  let jsonContent = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }

    if (jsonStart === -1) {
      // Look for the start of the JSON object
      if (line.trim() === "{") {
        jsonStart = i;
        jsonContent = line;
        braceCount = 1;
        continue;
      }
    } else {
      jsonContent += "\n" + line;
      // Count braces
      for (const char of line) {
        if (char === "{") braceCount++;
        if (char === "}") braceCount--;
      }
      if (braceCount === 0) {
        // Found complete JSON object
        try {
          const parsed = JSON.parse(jsonContent);
          // Verify it's the routes output
          if ("pages" in parsed && "apis" in parsed) {
            return jsonContent;
          }
        } catch {
          // Not valid JSON, continue searching
        }
        // Reset and continue looking
        jsonStart = -1;
        braceCount = 0;
        jsonContent = "";
      }
    }
  }

  throw new Error("No routes JSON found in output: " + text.slice(0, 500));
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

      const text = await captureConsoleLog(async () => {
        await routesCommand(context.projectDir, { json: true });
      });

      // Extract JSON from output (may contain log messages before the JSON)
      const jsonText = extractJson(text);
      const parsed = JSON.parse(jsonText) as {
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
});
