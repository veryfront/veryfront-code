import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateDevFilePath } from "./path-validator.ts";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import type { HandlerContext } from "../../types.ts";

function makeCtx(
  projectDir: string,
  stat: () => Promise<{ isFile: boolean }> = () => Promise.resolve({ isFile: true }),
): HandlerContext {
  return {
    projectDir,
    adapter: {
      fs: {
        stat,
      },
    },
  } as unknown as HandlerContext;
}

describe("server/handlers/dev/files/path-validator", () => {
  it("should return error for invalid base64 encoding", async () => {
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath("!!!invalid!!!", ctx);
    assertEquals(result, { kind: "rejected", message: "Invalid path encoding" });
    assertEquals(Object.isFrozen(result), true);
  });

  it("should return error for path outside project directory", async () => {
    const encoded = toBase64Url("/etc/passwd");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { kind: "rejected", message: "Path outside project" });
  });

  it("should return error for disallowed top-level directory", async () => {
    const encoded = toBase64Url("node_modules/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { kind: "rejected", message: "Access to directory not allowed" });
  });

  it("should reject when stat reports canonical absence", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx(
      "/project",
      () => Promise.reject(new Deno.errors.NotFound("missing dev file")),
    );
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { kind: "rejected", message: "File not found" });
  });

  it("should return error when path is a directory", async () => {
    const encoded = toBase64Url("src/foo");
    const ctx = makeCtx("/project", () => Promise.resolve({ isFile: false }));
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { kind: "rejected", message: "Not a file" });
  });

  it("should return absolute path for valid file in allowed directory", async () => {
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { kind: "ready", path: "/project/src/foo.ts" });
    assertEquals(Object.isFrozen(result), true);
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
      assertEquals(result, { kind: "ready", path: `/project/${dir}/test.ts` });
    });
  }

  it("should handle absolute path within project", async () => {
    const encoded = toBase64Url("/project/src/foo.ts");
    const ctx = makeCtx("/project");
    const result = await validateDevFilePath(encoded, ctx);
    assertEquals(result, { kind: "ready", path: "/project/src/foo.ts" });
  });

  for (
    const [label, failure] of [
      [
        "a NotFound-named lookalike",
        Object.assign(new Error("not actually absent"), { name: "NotFound" }),
      ],
      ["an EACCES failure", Object.assign(new Error("access denied"), { code: "EACCES" })],
      ["an EIO failure", Object.assign(new Error("I/O failure"), { code: "EIO" })],
      ["an arbitrary failure", new Error("stat unavailable")],
      ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
    ] as const
  ) {
    it(`should fail closed on ${label} from stat`, async () => {
      const encoded = toBase64Url("src/foo.ts");
      const ctx = makeCtx("/project", () => Promise.reject(failure));

      const result = await validateDevFilePath(encoded, ctx);

      assertEquals(result, { kind: "rejected", message: "File not accessible" });
      assertEquals(Object.isFrozen(result), true);
    });
  }

  it("should fail closed on a hostile stat rejection without invoking its hooks", async () => {
    const failure = new Proxy({}, {
      get() {
        throw new Error("stat rejection must not be read");
      },
      getPrototypeOf() {
        throw new Error("stat rejection prototype must not escape");
      },
    });
    const encoded = toBase64Url("src/foo.ts");
    const ctx = makeCtx("/project", () => Promise.reject(failure));

    const result = await validateDevFilePath(encoded, ctx);

    assertEquals(result, { kind: "rejected", message: "File not accessible" });
  });
});
