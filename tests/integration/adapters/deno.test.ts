import { assert, assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "DenoAdapter",
  
  () => {
    describe("File system operations", () => {
      it("should handle file exists checks", async () => {
        await withTestContext("deno-adapter-fs-exists", async (context) => {
          const fp = join(context.projectDir, "test.txt");

          assertEquals(await denoAdapter.fs.exists(fp), false);
          await denoAdapter.fs.writeFile(fp, "hello");
          assertEquals(await denoAdapter.fs.exists(fp), true);
        });
      });

      it("should write and read files", async () => {
        await withTestContext("deno-adapter-fs-readwrite", async (context) => {
          const fp = join(context.projectDir, "test.txt");
          await denoAdapter.fs.writeFile(fp, "hello");

          const content = await denoAdapter.fs.readFile(fp);
          assertEquals(content, "hello");
        });
      });

      it("should stat files", async () => {
        await withTestContext("deno-adapter-fs-stat", async (context) => {
          const fp = join(context.projectDir, "test.txt");
          await denoAdapter.fs.writeFile(fp, "hello");

          const st = await denoAdapter.fs.stat(fp);
          assert(st.isFile);
        });
      });

      it("should read directories", async () => {
        await withTestContext("deno-adapter-fs-readdir", async (context) => {
          const fp = join(context.projectDir, "test.txt");
          await denoAdapter.fs.writeFile(fp, "hello");

          const names: string[] = [];
          for await (const entry of denoAdapter.fs.readDir(context.projectDir)) {
            names.push(entry.name);
          }
          assert(names.includes("test.txt"));
        });
      });

      it("should create and remove directories", async () => {
        await withTestContext("deno-adapter-fs-mkdir", async (context) => {
          const sub = join(context.projectDir, "sub");
          await denoAdapter.fs.mkdir(sub, { recursive: true });
          assertEquals((await denoAdapter.fs.stat(sub)).isDirectory, true);

          await denoAdapter.fs.remove(sub, { recursive: true });
          assertEquals(await denoAdapter.fs.exists(sub), false);
        });
      });
    });

    describe("Environment operations", () => {
      it("should get and set environment variables", async () => {
        // deno-lint-ignore require-await
        await withTestContext("deno-adapter-env", async (context) => {
          context.setEnv({ VF_TEST_ENV: "42" });
          assertEquals(denoAdapter.env.get("VF_TEST_ENV"), "42");

          const all = denoAdapter.env.toObject();
          assertEquals(all.VF_TEST_ENV, "42");
        });
      });
    });

    describe("Server operations", () => {
      it("should handle errors in request handler", async () => {
        const ac = new AbortController();
        let port = 0;

        const server = await denoAdapter.serve(
          (_req) => {
            throw new Error("boom");
          },
          {
            signal: ac.signal,
            onListen: (p) => {
              port = p.port;
            },
          },
        );

        try {
          const res = await fetch(`http://localhost:${port}/test`);
          await res.text();
          assertEquals(res.status, 500);
        } finally {
          ac.abort();
          await server.stop();
        }
      });
    });
  },
);
