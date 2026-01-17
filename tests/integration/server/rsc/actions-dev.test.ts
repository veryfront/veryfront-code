import { assertEquals } from "@std/assert";
import { afterAll, describe, it } from "@std/testing/bdd";
import "../../../_helpers/log-guard.ts";
import { join } from "@std/path";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Actions Dev Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  it("Dev server: RSC action endpoint basic validations (zod or fallback)", async () => {
    await withTestContext("rsc-dev-act", async (context) => {
      // Set environment variables for RSC mode
      context.setEnv({
        VERYFRONT_EXPERIMENTAL_RSC: "1",
        MODE: "development",
      });

      // Minimal project to boot dev server
      await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

      // Add deno.json for JSX configuration
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@19.1.1",
              "react-dom": "https://esm.sh/react-dom@19.1.1",
              "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Add veryfront.config.js
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { title: "RSC Test Site" };`,
      );

      await Deno.mkdir(join(context.projectDir, "app", "actions"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(context.projectDir, "app", "actions", "echo.ts"),
        "export default async function echo(x){ return `ok:${x}` }\n",
      );

      // Create dev server - TestContext handles port allocation and cleanup
      const server = await context.createDevServer({ enableHMR: false });
      const port = server.port;

      // Missing id -> 400
      let res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();

      // Invalid args type -> converts to empty array (current behavior)
      res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "echo", args: { bad: true } }),
      });
      assertEquals(res.status, 200);
      const json2 = await res.json();
      assertEquals(json2.ok, true);
      // When args is not an array, it's converted to empty array
      assertEquals(json2.result, "ok:undefined");

      // Invalid id traversal -> 400
      res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "../secret", args: [] }),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();

      // Happy path
      res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "echo", args: ["x"] }),
      });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.ok, true);
      assertEquals(json.result, "ok:x");

      // TestContext automatically handles server cleanup
    });
  });
});
