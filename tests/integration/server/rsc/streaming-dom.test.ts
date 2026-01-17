import { assert } from "@std/assert";
import { afterAll, describe, it } from "@std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";
import { join } from "@std/path";
import { consumeNdjsonStream, getContainer } from "../../../../src/rendering/rsc/client-dom.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

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
      return ids.get(id) || null;
    },
  };
  body.appendChild = (el: any) => {
    body.children.push(el);
    ids.set(el.id, el);
  };
  return doc as Document;
}

async function closeResponse(res: Response) {
  try {
    await res.body?.cancel?.();
  } catch (_err) {
    // ignore cancellation failures in tests
  }
  try {
    // Fallback read to satisfy Deno leak detector if cancel is a no-op
    await res.arrayBuffer();
  } catch (_err) {
    // ignoring as body may already be consumed/cancelled
  }
}

describe("RSC Stream DOM Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe(
    "RSC stream DOM",
    {},
    () => {
      it("applies interleaved slots to DOM (prod)", async () => {
        await withTestContext("rsc-stream-dom-prod", async (context) => {
          // Set RSC environment variable
          context.setEnv({
            VERYFRONT_EXPERIMENTAL_RSC: "1",
          });

          // Remove default app directory and create pages structure
          await Deno.remove(join(context.projectDir, "app"), { recursive: true });
          await Deno.remove(join(context.projectDir, "pages"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
          await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");

          const server = await context.createProductionServer({
            hostname: "127.0.0.1",
          });

          const res = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream?name=Eve`);
          const doc = createDocument();
          try {
            await consumeNdjsonStream(res, doc as any);
            const root = getContainer(doc as any, "root") as any;
            const sidebar = getContainer(doc as any, "sidebar") as any;
            // Root and sidebar should contain content (implementation can vary)
            assert(root.innerHTML.length > 0);
            assert(sidebar.innerHTML.length > 0);
          } finally {
            await closeResponse(res);
          }
        });
      });

      it("ignores malformed NDJSON lines (dev)", async () => {
        await withTestContext("rsc-stream-dom-dev", async (context) => {
          // Set RSC environment variable
          context.setEnv({
            VERYFRONT_EXPERIMENTAL_RSC: "1",
          });

          // Remove default pages directory
          await Deno.remove(join(context.projectDir, "pages"), { recursive: true });

          await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
          await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");

          await Deno.writeTextFile(
            join(context.projectDir, "deno.json"),
            JSON.stringify({
              compilerOptions: {
                jsx: "react-jsx",
                jsxImportSource: "react",
              },
            }),
          );

          // Add app router for RSC
          await Deno.writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`,
          );
          await Deno.writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() { return <div>App Home</div>; }`,
          );

          const server = await context.createDevServer({ enableHMR: false });

          // Verify readiness endpoint reports ready
          const start = Date.now();
          let ok = false;
          while (Date.now() - start < 5000) {
            try {
              const r = await fetch(`http://127.0.0.1:${server.port}/readyz`);
              try {
                if (r.status === 200) {
                  ok = true;
                  break;
                }
              } finally {
                await closeResponse(r);
              }
            } catch (_e) {
              console.debug?.("[test] /readyz check failed");
            }
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!ok) throw new Error("Server reported not-ready via /readyz");

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
    },
  );
});
