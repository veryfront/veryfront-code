import { assertEquals } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "@veryfront/compat/process.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

function withCacheAllowClose<T>(fn: () => Promise<T>): Promise<T> {
  const originalAllowClose = getEnv("VF_CACHE_ALLOW_CLOSE");
  setEnv("VF_CACHE_ALLOW_CLOSE", "1");

  return (async () => {
    try {
      return await fn();
    } finally {
      if (originalAllowClose === undefined) {
        deleteEnv("VF_CACHE_ALLOW_CLOSE");
      } else {
        setEnv("VF_CACHE_ALLOW_CLOSE", originalAllowClose);
      }
    }
  })();
}

async function enableRsc(context: { projectDir: string }): Promise<void> {
  await writeTextFile(
    join(context.projectDir, "veryfront.config.js"),
    `export default { experimental: { rsc: true } };`,
  );
}

describe("RSC Actions Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  it("RSC - action endpoint handles server actions correctly", async () => {
    await withCacheAllowClose(async () => {
      await withTestContext("rsc-actions", async (context) => {
        await enableRsc(context);

        await mkdir(join(context.projectDir, "app", "actions"), { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "actions", "echo.ts"),
          `export default async function echo(input: string): Promise<string> {
          return \`ok:\${input}\`;
        }`,
        );

        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# RSC Test Home");

        const server = await context.createProductionServer();

        const response = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "echo", args: ["test-input"] }),
        });

        assertEquals(response.status, 200, "Should return 200 for valid action");
        const data = await response.json();
        assertEquals(data.ok, true, "Should indicate success");
        assertEquals(data.result, "ok:test-input", "Should return expected result");
      });
    });
  });

  it("RSC - action endpoint validates request format", async () => {
    await withCacheAllowClose(async () => {
      await withTestContext("rsc-validation", async (context) => {
        await enableRsc(context);
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createProductionServer();

        const missingIdResponse = await fetch(
          `http://127.0.0.1:${server.port}/_veryfront/rsc/action`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ args: [] }),
          },
        );

        assertEquals(missingIdResponse.status, 400, "Should return 400 for missing action ID");
        const errorText = await missingIdResponse.text();
        assertEquals(typeof errorText, "string", "Should return error message");
      });
    });
  });

  it("RSC - action endpoint returns 404 for non-existent actions", async () => {
    await withCacheAllowClose(async () => {
      await withTestContext("rsc-not-found", async (context) => {
        await enableRsc(context);
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createProductionServer();

        const response = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "nonExistentAction", args: [] }),
        });

        assertEquals(response.status, 404, "Should return 404 for non-existent action");
        const errorText = await response.text();
        assertEquals(typeof errorText, "string", "Should return error message");
      });
    });
  });

  it("RSC - action endpoint enforces POST method", async () => {
    await withCacheAllowClose(async () => {
      await withTestContext("rsc-method-restriction", async (context) => {
        await enableRsc(context);
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createProductionServer();
        const url = `http://127.0.0.1:${server.port}/_veryfront/rsc/action`;

        const getResponse = await fetch(url);
        assertEquals(getResponse.status, 405, "Should return 405 for GET request");
        await getResponse.text();

        const putResponse = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "test", args: [] }),
        });
        assertEquals(putResponse.status, 405, "Should return 405 for PUT request");
        await putResponse.text();
      });
    });
  });
});
