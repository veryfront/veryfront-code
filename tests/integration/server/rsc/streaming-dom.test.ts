import { assert } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { consumeNdjsonStream, getContainer } from "../../../../src/rendering/rsc/client-dom.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { delay } from "#std/async";

function createDocument(): Document {
  const ids = new Map<string, any>();

  const body: any = {
    children: [] as any[],
    appendChild(el: any) {
      this.children.push(el);
      ids.set(el.id, el);
    },
  };

  const doc: any = {
    body,
    createElement(tag: string) {
      return {
        tag,
        id: "",
        innerHTML: "",
        dataset: {},
        children: [] as any[],
        appendChild(c: any) {
          this.children.push(c);
        },
      };
    },
    getElementById(id: string) {
      return ids.get(id) ?? null;
    },
  };

  return doc as Document;
}

async function closeResponse(res: Response): Promise<void> {
  try {
    await res.body?.cancel?.();
  } catch {
    // ignore cancellation failures in tests
  }

  try {
    // Fallback read to satisfy Deno leak detector if cancel is a no-op
    await res.arrayBuffer();
  } catch {
    // ignoring as body may already be consumed/cancelled
  }
}

async function waitForReady(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/readyz`);
      try {
        if (r.status === 200) return;
      } finally {
        await closeResponse(r);
      }
    } catch {
      console.debug?.("[test] /readyz check failed");
    }

    await delay(100);
  }

  throw new Error("Server reported not-ready via /readyz");
}

describe("RSC Stream DOM Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC stream DOM", {}, () => {
    it("applies interleaved slots to DOM (prod)", async () => {
      await withTestContext("rsc-stream-dom-prod", async (context) => {
        await remove(join(context.projectDir, "app"), { recursive: true });
        await remove(join(context.projectDir, "pages"), { recursive: true });

        await mkdir(join(context.projectDir, "pages"), { recursive: true });
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const server = await context.createProductionServer({ hostname: "127.0.0.1" });

        const res = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream?name=Eve`);
        const doc = createDocument();

        try {
          await consumeNdjsonStream(res, doc as any);

          const root = getContainer(doc as any, "root") as any;
          const sidebar = getContainer(doc as any, "sidebar") as any;

          assert(root.innerHTML.length > 0);
          assert(sidebar.innerHTML.length > 0);
        } finally {
          await closeResponse(res);
        }
      });
    });

    it("ignores malformed NDJSON lines (dev)", async () => {
      await withTestContext("rsc-stream-dom-dev", async (context) => {
        await remove(join(context.projectDir, "pages"), { recursive: true });

        await mkdir(join(context.projectDir, "pages"), { recursive: true });
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");

        await writeTextFile(
          join(context.projectDir, "deno.json"),
          JSON.stringify({
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
          }),
        );
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`,
        );
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Page() { return <div>App Home</div>; }`,
        );

        const server = await context.startDevServer({ enableHMR: false });
        if (!server.port) throw new Error("Server port not assigned");
        await waitForReady(server.port);

        const ac = new AbortController();
        const res = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream?bad=1`, {
          signal: ac.signal,
        });

        if (!res.body) throw new Error("expected body");

        const doc = createDocument();

        try {
          await consumeNdjsonStream(res, doc as any);

          const root = getContainer(doc as any, "root") as any;
          const sidebar = getContainer(doc as any, "sidebar") as any;

          assert(/<aside>/.test(sidebar.innerHTML));
          assert(root.innerHTML.length > 0);
        } finally {
          await closeResponse(res);
        }
      });
    });
  });
});
