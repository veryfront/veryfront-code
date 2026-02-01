import { assert, assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { isDeno } from "../../../src/platform/compat/runtime.ts";
import { withTestContext } from "../../_helpers/context.ts";

if (!isDeno) {
  describe("DenoAdapter", () => {
    it("skipped - not running in Deno", { ignore: true }, () => {});
  });
} else {
  async function getDenoAdapter() {
    const { denoAdapter } = await import("#veryfront/platform/adapters/runtime/deno/index.ts");
    return denoAdapter;
  }

  describe("DenoAdapter", () => {
    describe("File system operations", () => {
      it("should handle file exists checks", async () => {
        const adapter = await getDenoAdapter();

        await withTestContext("deno-adapter-fs-exists", async (context) => {
          const fp = join(context.projectDir, "test.txt");

          assertEquals(await adapter.fs.exists(fp), false);
          await adapter.fs.writeFile(fp, "hello");
          assertEquals(await adapter.fs.exists(fp), true);
        });
      });

      it("should write and read files", async () => {
        const adapter = await getDenoAdapter();

        await withTestContext("deno-adapter-fs-readwrite", async (context) => {
          const fp = join(context.projectDir, "test.txt");
          await adapter.fs.writeFile(fp, "hello");

          const content = await adapter.fs.readFile(fp);
          assertEquals(content, "hello");
        });
      });

      it("should stat files", async () => {
        const adapter = await getDenoAdapter();

        await withTestContext("deno-adapter-fs-stat", async (context) => {
          const fp = join(context.projectDir, "test.txt");
          await adapter.fs.writeFile(fp, "hello");

          const st = await adapter.fs.stat(fp);
          assert(st.isFile);
        });
      });

      it("should read directories", async () => {
        const adapter = await getDenoAdapter();

        await withTestContext("deno-adapter-fs-readdir", async (context) => {
          const fp = join(context.projectDir, "test.txt");
          await adapter.fs.writeFile(fp, "hello");

          const names: string[] = [];
          for await (const entry of adapter.fs.readDir(context.projectDir)) {
            names.push(entry.name);
          }
          assert(names.includes("test.txt"));
        });
      });

      it("should create and remove directories", async () => {
        const adapter = await getDenoAdapter();

        await withTestContext("deno-adapter-fs-mkdir", async (context) => {
          const sub = join(context.projectDir, "sub");
          await adapter.fs.mkdir(sub, { recursive: true });
          assertEquals((await adapter.fs.stat(sub)).isDirectory, true);

          await adapter.fs.remove(sub, { recursive: true });
          assertEquals(await adapter.fs.exists(sub), false);
        });
      });
    });

    describe("Environment operations", () => {
      it("should get and set environment variables", async () => {
        const adapter = await getDenoAdapter();

        // deno-lint-ignore require-await
        await withTestContext("deno-adapter-env", async (context) => {
          context.setEnv({ VF_TEST_ENV: "42" });
          assertEquals(adapter.env.get("VF_TEST_ENV"), "42");

          const all = adapter.env.toObject();
          assertEquals(all.VF_TEST_ENV, "42");
        });
      });
    });

    describe("Server operations", () => {
      it("should handle errors in request handler", async () => {
        const adapter = await getDenoAdapter();

        const ac = new AbortController();
        let port = 0;

        let resolveReady: (() => void) | undefined;
        const ready = new Promise<void>((resolve) => {
          resolveReady = resolve;
        });

        const server = await adapter.serve(
          (_req: Request) => {
            throw new Error("boom");
          },
          {
            port: 0,
            hostname: "127.0.0.1",
            signal: ac.signal,
            onListen: (p: { port: number }) => {
              port = p.port;
              resolveReady?.();
            },
          },
        );

        await ready;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/test`);
          await res.text();
          assertEquals(res.status, 500);
        } finally {
          ac.abort();
          await server.stop();
        }
      });
    });
  });
}
