import { assert, assertEquals } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { isDeno } from "../../../src/platform/compat/runtime.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Skip all tests if not running in Deno
if (!isDeno) {
  describe("DenoAdapter", () => {
    it("skipped - not running in Deno", { ignore: true }, () => {});
  });
} else {
  // This test file specifically tests Deno adapter - skip in other runtimes
  // Lazy load denoAdapter only when running in Deno
  const getDenoAdapter = async () => {
    const { denoAdapter } = await import("@veryfront/platform/adapters/runtime/deno/index.ts");
    return denoAdapter;
  };

  describe(
    "DenoAdapter",
    () => {
      describe("File system operations", () => {
        it("should handle file exists checks", async () => {
          await withTestContext("deno-adapter-fs-exists", async (context) => {
            const fp = join(context.projectDir, "test.txt");

            assertEquals(await (await getDenoAdapter()).fs.exists(fp), false);
            await (await getDenoAdapter()).fs.writeFile(fp, "hello");
            assertEquals(await (await getDenoAdapter()).fs.exists(fp), true);
          });
        });

        it("should write and read files", async () => {
          await withTestContext("deno-adapter-fs-readwrite", async (context) => {
            const fp = join(context.projectDir, "test.txt");
            await (await getDenoAdapter()).fs.writeFile(fp, "hello");

            const content = await (await getDenoAdapter()).fs.readFile(fp);
            assertEquals(content, "hello");
          });
        });

        it("should stat files", async () => {
          await withTestContext("deno-adapter-fs-stat", async (context) => {
            const fp = join(context.projectDir, "test.txt");
            await (await getDenoAdapter()).fs.writeFile(fp, "hello");

            const st = await (await getDenoAdapter()).fs.stat(fp);
            assert(st.isFile);
          });
        });

        it("should read directories", async () => {
          await withTestContext("deno-adapter-fs-readdir", async (context) => {
            const fp = join(context.projectDir, "test.txt");
            await (await getDenoAdapter()).fs.writeFile(fp, "hello");

            const names: string[] = [];
            for await (const entry of (await getDenoAdapter()).fs.readDir(context.projectDir)) {
              names.push(entry.name);
            }
            assert(names.includes("test.txt"));
          });
        });

        it("should create and remove directories", async () => {
          await withTestContext("deno-adapter-fs-mkdir", async (context) => {
            const sub = join(context.projectDir, "sub");
            await (await getDenoAdapter()).fs.mkdir(sub, { recursive: true });
            assertEquals((await (await getDenoAdapter()).fs.stat(sub)).isDirectory, true);

            await (await getDenoAdapter()).fs.remove(sub, { recursive: true });
            assertEquals(await (await getDenoAdapter()).fs.exists(sub), false);
          });
        });
      });

      describe("Environment operations", () => {
        it("should get and set environment variables", async () => {
          // deno-lint-ignore require-await
          await withTestContext("deno-adapter-env", async (context) => {
            context.setEnv({ VF_TEST_ENV: "42" });
            assertEquals((await getDenoAdapter()).env.get("VF_TEST_ENV"), "42");

            const all = (await getDenoAdapter()).env.toObject();
            assertEquals(all.VF_TEST_ENV, "42");
          });
        });
      });

      describe("Server operations", () => {
        it("should handle errors in request handler", async () => {
          const ac = new AbortController();
          let port = 0;
          let resolveReady: () => void;
          const ready = new Promise<void>((resolve) => {
            resolveReady = resolve;
          });

          const server = await (await getDenoAdapter()).serve(
            (_req: Request) => {
              throw new Error("boom");
            },
            {
              port: 0, // Use random available port
              hostname: "127.0.0.1", // Explicit IPv4 to match fetch
              signal: ac.signal,
              onListen: (p: { port: number }) => {
                port = p.port;
                resolveReady();
              },
            },
          );

          // Wait for server to be ready
          await ready;

          try {
            const res = await fetch(`http://127.0.0.1:${port}/test`);
            await res.text(); // Consume response body
            assertEquals(res.status, 500);
          } finally {
            ac.abort();
            await server.stop();
          }
        });
      });
    },
  );
} // end else isDeno
