import { assertEquals } from "std/assert/mod.ts";
import { afterAll } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

Deno.test({
  name: "Dev server: RSC action endpoint basic validations (zod or fallback)",
  fn: async () => {
    await withTestContext("rsc-dev-act", async (context) => {
      context.setEnv({
        VERYFRONT_EXPERIMENTAL_RSC: "1",
        MODE: "development",
      });

      await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

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

      const server = await context.createDevServer({ enableHMR: false });
      const port = server.port;

      let res = await fetch(`http://localhost:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();

      res = await fetch(`http://localhost:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "echo", args: { bad: true } }),
      });
      assertEquals(res.status, 200);
      const json2 = await res.json();
      assertEquals(json2.ok, true);
      assertEquals(json2.result, "ok:undefined");

      res = await fetch(`http://localhost:${port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "../secret", args: [] }),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();

      res = await fetch(`http://localhost:${port}/_veryfront/rsc/action`, {
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
  },
});
