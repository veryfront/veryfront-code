import { assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import "../../../_helpers/log-guard.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Actions Dev Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  it("Dev server: RSC action endpoint basic validations (zod or fallback)", async () => {
    await withTestContext("rsc-dev-act", async (context) => {
      context.setEnv({ MODE: "development" });

      await mkdir(join(context.projectDir, "pages"), { recursive: true });
      await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

      await writeTextFile(
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

      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default {
          title: "RSC Test Site",
          experimental: { rsc: true }
        };`,
      );

      await mkdir(join(context.projectDir, "app", "actions"), { recursive: true });
      await writeTextFile(
        join(context.projectDir, "app", "actions", "echo.ts"),
        "export default async function echo(x){ return `ok:${x}` }\n",
      );

      const { port } = await context.createDevServer({ enableHMR: false });
      const url = `http://127.0.0.1:${port}/_veryfront/rsc/action`;
      const headers = { "content-type": "application/json" };

      // Missing id -> 400
      let res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();

      // Invalid args type -> converts to empty array (current behavior)
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "echo", args: { bad: true } }),
      });
      assertEquals(res.status, 200);
      const json2 = await res.json();
      assertEquals(json2.ok, true);
      assertEquals(json2.result, "ok:undefined");

      // Invalid id traversal -> 400
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "../secret", args: [] }),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();

      // Happy path
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "echo", args: ["x"] }),
      });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.ok, true);
      assertEquals(json.result, "ok:x");
    });
  });
});
