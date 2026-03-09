import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateDevFilePath } from "./path-validator.ts";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import type { HandlerContext } from "../../types.ts";

function makeCtx(
  projectDir: string,
  statResult?: { isFile: boolean } | "throw",
): HandlerContext {
  return {
    projectDir,
    adapter: {
      fs: {
        stat: async (_path: string) => {
          if (statResult === "throw") throw new Error("not found");
          return statResult ?? { isFile: true };
        },
      },
    },
  } as unknown as HandlerContext;
}

describe("server/handlers/dev/files/path-validator", () => {
  it("should return error for invalid base64 encoding", async () => {
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath("!!!invalid!!!", ctx);
    assertEquals(result, "Error: Invalid path encoding");
  });

  it("should return error for path outside project directory", async () => {
    const encoded = toBase64Url("/etc/passwd");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, "Error: Path outside project");
  });

  it("should return error for disallowed top-level directory", async () => {
    const encoded = toBase64Url("node_modules/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, "Error: Access to directory not allowed");
  });

  it("should return error when file does not exist", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project", "throw");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, "Error: File not found");
  });

  it("should return error when path is a directory", async () => {
    const encoded = toBase64Url("src/foo");
    const ctx = makeCtx("/project", { isFile: false });
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, "Error: Not a file");
  });

  it("should return absolute path for valid file in allowed directory", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project", { isFile: true });
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, "/project/src/foo.ts");
  });

  for (
    const dir of [
      "app",
      "pages",
      "components",
      "islands",
      "public",
      "shared",
      "modules",
      "server",
      "client",
      "lib",
      "routes",
    ]
  ) {
    it(`should allow files in '${dir}' directory`, async () => {
      const encoded = toBase64Url(`${dir}/test.ts`);
      const ctx = makeCtx("/project", { isFile: true });
      const result = await validateDevFilePath(encoded, ctx);
      assertEquals(result, `/project/${dir}/test.ts`);
    });
  }

  it("should handle absolute path within project", async () => {
    const encoded = toBase64Url("/project/src/foo.ts");
    const ctx = makeCtx("/project", { isFile: true });
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, "/project/src/foo.ts");
  });
});
