import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { makeTempDir, readDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import type { ApiClient } from "../../../../../../cli/shared/config.ts";

type UploadCommandModule = typeof import("../../../../../../cli/commands/uploads/command.ts");

const originalBind = Function.prototype.bind;
const originalDefineProperty = Object.defineProperty;
const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const originalReflectApply = Reflect.apply;

function importFreshUploadCommand(label: string): Promise<UploadCommandModule> {
  const moduleUrl = new URL("../../../../../../cli/commands/uploads/command.ts", import.meta.url);
  moduleUrl.search = `${label}=${crypto.randomUUID()}`;
  return import(moduleUrl.href) as Promise<UploadCommandModule>;
}

describe("uploads download stream capabilities", () => {
  it("does not bind the private atomic writer during lazy command import", async () => {
    let boundAtomicWriter = false;

    try {
      originalDefineProperty(Function.prototype, "bind", {
        configurable: true,
        writable: true,
        value: function patchedBind(
          this: (...args: unknown[]) => unknown,
          thisArg: unknown,
          ...args: unknown[]
        ): unknown {
          if (typeof thisArg === "object" && thisArg !== null) {
            const descriptor = originalGetOwnPropertyDescriptor(thisArg, "writeFileStreamAtomic");
            if (descriptor && "value" in descriptor && descriptor.value === this) {
              boundAtomicWriter = true;
            }
          }
          return originalReflectApply(originalBind, this, [thisArg, ...args]);
        },
      });

      await importFreshUploadCommand("lazy-bind-probe");
    } finally {
      originalDefineProperty(Function.prototype, "bind", {
        configurable: true,
        writable: true,
        value: originalBind,
      });
    }

    assertEquals(boundAtomicWriter, false);
  });

  it("writes a private upload stream with the atomic filesystem writer", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-upload-download-" });
    try {
      const { downloadUploadToFile } = await importFreshUploadCommand("actual-writer");
      let requestedPath = "";
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("private report"));
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const client: ApiClient = {
        getStream(path) {
          requestedPath = path;
          return Promise.resolve(stream);
        },
        get() {
          throw new Error("unexpected JSON get");
        },
        post() {
          throw new Error("unexpected post");
        },
        put() {
          throw new Error("unexpected put");
        },
        patch() {
          throw new Error("unexpected patch");
        },
        delete() {
          throw new Error("unexpected delete");
        },
      };

      const result = await downloadUploadToFile(
        client,
        "my-project",
        "reports/private.txt",
        tempDir,
      );

      assertEquals(requestedPath, "/projects/my-project/uploads/reports%2Fprivate.txt");
      assertEquals(result.uploadPath, "reports/private.txt");
      assertEquals(result.localPath, join(tempDir, "reports/private.txt"));
      assertEquals(result.bytes, "private report".length);
      assertEquals(await readTextFile(result.localPath), "private report");
      const outputEntries = [];
      for await (const entry of readDir(tempDir)) outputEntries.push(entry.name);
      assertEquals(outputEntries.sort(), ["reports"]);
      const reportEntries = [];
      for await (const entry of readDir(join(tempDir, "reports"))) reportEntries.push(entry.name);
      assertEquals(reportEntries, ["private.txt"]);
      assertEquals(cancelled, false);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});
