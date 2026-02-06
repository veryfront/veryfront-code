import { assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { withTestContext } from "../../_helpers/context.ts";
import { delay } from "#std/async";

describe(
  "Dev HMR",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("client boundary re-hydrates after file change", async () => {
      await withTestContext("rsc-dev-hmr-hydration", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page(){ return <div data-client-ref="/app/Client.client.tsx#default">INIT</div>; }`,
        );

        const clientPath = join(context.projectDir, "app", "Client.client.tsx");
        const writeClient = (version: "V1" | "V2"): Promise<void> =>
          writeTextFile(
            clientPath,
            `'use client'\nexport default function C(){ return <span>${version}</span>; }`,
          );

        await writeClient("V1");

        const server = await context.startDevServer({ enableHMR: true });
        await delay(500);

        const fetchPage = async (): Promise<void> => {
          const res = await fetch(
            `http://127.0.0.1:${server.port}/_veryfront/rsc/page`,
          );
          assertEquals(res.status, 200);
          await res.body?.cancel();
        };

        try {
          await fetchPage();

          await writeClient("V2");
          await delay(400);

          await fetchPage();
        } finally {
          await server.stop();
          await delay(100);
        }
      });
    });
  },
);
