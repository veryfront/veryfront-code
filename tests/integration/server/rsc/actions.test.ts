
import { assertEquals } from "std/assert/mod.ts";
import { afterAll } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

Deno.test(
  "RSC - action endpoint handles server actions correctly",
  {},
  async () => {
    const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
    Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

    try {
      await withTestContext("rsc-actions", async (context) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await Deno.mkdir(join(context.projectDir, "app", "actions"), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(context.projectDir, "app", "actions", "echo.ts"),
          `export default async function echo(input: string): Promise<string> {
          return \`ok:\${input}\`;
        }`,
        );

        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# RSC Test Home");

        const server = await context.createProductionServer();

        const response = await fetch(`http://localhost:${server.port}/_veryfront/rsc/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "echo", args: ["test-input"] }),
        });

        assertEquals(response.status, 200, "Should return 200 for valid action");
        const data = await response.json();
        assertEquals(data.ok, true, "Should indicate success");
        assertEquals(data.result, "ok:test-input", "Should return expected result");
      });
    } finally {
      if (originalAllowClose === undefined) {
        Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
      } else {
        Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
      }
    }
  },
);

Deno.test("RSC - action endpoint validates request format", async () => {
  const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
  Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

  try {
    await withTestContext("rsc-validation", async (context) => {
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

      const server = await context.createProductionServer();

      const missingIdResponse = await fetch(
        `http://localhost:${server.port}/_veryfront/rsc/action`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ args: [] }), // Missing 'id' field
        },
      );

      assertEquals(missingIdResponse.status, 400, "Should return 400 for missing action ID");
      const errorText = await missingIdResponse.text();
      assertEquals(typeof errorText, "string", "Should return error message");
    });
  } finally {
    if (originalAllowClose === undefined) {
      Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
    } else {
      Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
    }
  }
});

Deno.test("RSC - action endpoint returns 404 for non-existent actions", async () => {
  const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
  Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

  try {
    await withTestContext("rsc-not-found", async (context) => {
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

      const server = await context.createProductionServer();

      const response = await fetch(`http://localhost:${server.port}/_veryfront/rsc/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "nonExistentAction", args: [] }),
      });

      assertEquals(response.status, 404, "Should return 404 for non-existent action");
      const errorText = await response.text();
      assertEquals(typeof errorText, "string", "Should return error message");
    });
  } finally {
    if (originalAllowClose === undefined) {
      Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
    } else {
      Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
    }
  }
});

Deno.test("RSC - action endpoint enforces POST method", async () => {
  const originalAllowClose = Deno.env.get("VF_CACHE_ALLOW_CLOSE");
  Deno.env.set("VF_CACHE_ALLOW_CLOSE", "1");

  try {
    await withTestContext("rsc-method-restriction", async (context) => {
      await Deno.writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { experimental: { rsc: true } };`,
      );

      await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

      const server = await context.createProductionServer();

      const getResponse = await fetch(`http://localhost:${server.port}/_veryfront/rsc/action`);
      assertEquals(getResponse.status, 405, "Should return 405 for GET request");

      await getResponse.text();

      const putResponse = await fetch(`http://localhost:${server.port}/_veryfront/rsc/action`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "test", args: [] }),
      });
      assertEquals(putResponse.status, 405, "Should return 405 for PUT request");
      await putResponse.text();
    });
  } finally {
    if (originalAllowClose === undefined) {
      Deno.env.delete("VF_CACHE_ALLOW_CLOSE");
    } else {
      Deno.env.set("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
    }
  }
});
