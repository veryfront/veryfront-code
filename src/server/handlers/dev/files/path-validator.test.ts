import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateDevFilePath } from "./path-validator.ts";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import type { HandlerContext } from "../../types.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors";

function makeCtx(
  projectDir: string,
  options: {
    realPath?: (path: string) => Promise<string>;
    stat?: (path: string) => Promise<{ isFile: boolean }>;
  } = {},
): HandlerContext {
  return {
    projectDir,
    adapter: {
      fs: {
        realPath: options.realPath ?? ((path: string) => Promise.resolve(path)),
        stat: options.stat ?? (() => Promise.resolve({ isFile: true })),
      },
    },
  } as unknown as HandlerContext;
}

describe("server/handlers/dev/files/path-validator", () => {
  it("should return error for invalid base64 encoding", async () => {
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath("!!!invalid!!!", ctx);
    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("should return error for path outside project directory", async () => {
    const encoded = toBase64Url("/etc/passwd");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("rejects normalized traversal outside the project directory", async () => {
    const encoded = toBase64Url("src/../../../private/secret.ts");
    const result = await validateDevFilePath(encoded, makeCtx("/project"));

    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("should return error for disallowed top-level directory", async () => {
    const encoded = toBase64Url("node_modules/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("should return error when file does not exist", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project", {
      stat: () => Promise.reject(FILE_NOT_FOUND.create({ message: "File not found" })),
    });
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { ok: false, reason: "not_found" });
  });

  it("distinguishes permission failures from missing files", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project", {
      stat: () => Promise.reject(new Deno.errors.PermissionDenied("private path")),
    });
    const result = await validateDevFilePath(encoded, ctx);

    assertEquals(result, { ok: false, reason: "unavailable" });
  });

  it("should return error when path is a directory", async () => {
    const encoded = toBase64Url("src/foo");
    const ctx = makeCtx("/project", {
      stat: () => Promise.resolve({ isFile: false }),
    });
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { ok: false, reason: "not_found" });
  });

  it("rejects a symlink whose canonical target escapes the project", async () => {
    const encoded = toBase64Url("src/link.ts");
    const ctx = makeCtx("/project", {
      realPath: (path) =>
        Promise.resolve(path === "/project/src/link.ts" ? "/private/secret.ts" : path),
    });
    const result = await validateDevFilePath(encoded, ctx);

    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("rejects a safe-looking symlink to a disallowed in-project path", async () => {
    const encoded = toBase64Url("src/config.ts");
    const ctx = makeCtx("/project", {
      realPath: (path) =>
        Promise.resolve(path === "/project/src/config.ts" ? "/project/.env" : path),
    });
    const result = await validateDevFilePath(encoded, ctx);

    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("allows a symlink whose canonical target remains in an allowed project directory", async () => {
    const encoded = toBase64Url("src/link.ts");
    const ctx = makeCtx("/project", {
      realPath: (path) =>
        Promise.resolve(path === "/project/src/link.ts" ? "/project/shared/real.ts" : path),
    });
    const result = await validateDevFilePath(encoded, ctx);

    assertEquals(result, { ok: true, path: "/project/shared/real.ts" });
  });

  it("rejects sensitive project files", async () => {
    for (const path of ["src/.env", "app/private.key", ".git/config"]) {
      const result = await validateDevFilePath(toBase64Url(path), makeCtx("/project"));
      assertEquals(result, { ok: false, reason: "invalid" });
    }
  });

  it("bounds encoded paths before decoding", async () => {
    const result = await validateDevFilePath("a".repeat(8_192), makeCtx("/project"));

    assertEquals(result, { ok: false, reason: "invalid" });
  });

  it("should return absolute path for valid file in allowed directory", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { ok: true, path: "/project/src/foo.ts" });
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
      const ctx = makeCtx("/project");
      const result = await validateDevFilePath(encoded, ctx);
      assertEquals(result, { ok: true, path: `/project/${dir}/test.ts` });
    });
  }

  it("should handle absolute path within project", async () => {
    const encoded = toBase64Url("/project/src/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { ok: true, path: "/project/src/foo.ts" });
  });
});
