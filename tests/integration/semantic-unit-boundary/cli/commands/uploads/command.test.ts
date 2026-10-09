// @veryfront-test runtime-guarded-deno
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createFileSystem } from "veryfront/platform";
import { writeStreamExclusive } from "#veryfront/platform/compat/fs.ts";
import { VeryfrontError } from "veryfront/errors";
import {
  buildUploadCreateUrl,
  buildUploadSignedUrlPath,
  buildUploadsListUrl,
  deleteUpload,
  downloadUploadToFile,
  listAllUploads,
  resolveUploadOutputPath,
  uploadLocalFileToUploads,
  uploadsCommand,
} from "#cli/commands/uploads/command";
import type { ApiClient } from "../../../../../../cli/shared/config.ts";
import type { ParsedArgs } from "../../../../../../cli/shared/types.ts";

const denoOnlyIt = typeof Deno === "undefined" ? it.skip : it;
const nodeOnlyIt = typeof Deno === "undefined" &&
    typeof process !== "undefined" &&
    Boolean(process.versions?.node)
  ? it
  : it.skip;

function createMockClient(overrides: {
  getStream?: (path: string) => Promise<ReadableStream<Uint8Array>>;
  get?: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post?: (path: string, body?: unknown) => Promise<unknown>;
  delete?: (path: string) => Promise<unknown>;
} = {}): ApiClient {
  return {
    getStream: overrides.getStream,
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.post?.(path, body) ?? Promise.resolve({}));
      return result as T;
    },
    put: <T>(): Promise<T> => Promise.resolve({} as T),
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: async <T>(path: string): Promise<T> => {
      const result = await (overrides.delete?.(path) ?? Promise.resolve({}));
      return result as T;
    },
  };
}

describe("buildUploadsListUrl", () => {
  it("builds the project uploads endpoint", () => {
    assertEquals(buildUploadsListUrl("my-project"), "/projects/my-project/uploads");
  });
});

describe("buildUploadCreateUrl", () => {
  it("builds the uploads create endpoint", () => {
    assertEquals(buildUploadCreateUrl("my-project"), "/projects/my-project/uploads");
  });
});

describe("buildUploadSignedUrlPath", () => {
  it("encodes nested upload paths", () => {
    assertEquals(
      buildUploadSignedUrlPath("my-project", "contracts/q1 report.pdf"),
      "/projects/my-project/uploads/contracts%2Fq1%20report.pdf/url",
    );
  });
});

describe("listAllUploads", () => {
  it("paginates through upload results", async () => {
    const calls: Array<{ path: string; params?: Record<string, string> }> = [];

    const client = createMockClient({
      get: (path, params) => {
        calls.push({ path, params });
        if (calls.length === 1) {
          return Promise.resolve({
            data: [
              { type: "file", path: "contracts/q1.pdf", file_name: "q1.pdf", size: 10 },
            ],
            page_info: { next: "cursor-2" },
          });
        }

        return Promise.resolve({
          data: [
            { type: "file", path: "contracts/q2.pdf", file_name: "q2.pdf", size: 20 },
          ],
          page_info: { next: null },
        });
      },
    });

    const uploads = await listAllUploads(client, "my-project", {
      path: "contracts/",
      recursive: true,
    });

    assertEquals(uploads.map((upload: { path: string }) => upload.path), [
      "contracts/q1.pdf",
      "contracts/q2.pdf",
    ]);
    assertEquals(calls[0]?.path, "/projects/my-project/uploads");
    assertEquals(calls[0]?.params, { limit: "100", path: "contracts/", recursive: "true" });
    assertEquals(calls[1]?.params, {
      limit: "100",
      path: "contracts/",
      recursive: "true",
      cursor: "cursor-2",
    });
  });
});

describe("resolveUploadOutputPath", () => {
  it("preserves nested paths under the output dir", () => {
    assertStringIncludes(
      resolveUploadOutputPath("contracts/q1.pdf", "/workspace/uploads"),
      "/workspace/uploads/contracts/q1.pdf",
    );
  });

  it("rejects traversal attempts as invalid-argument usage errors", () => {
    const error = assertThrows(
      () => resolveUploadOutputPath("../secrets.txt", "/workspace/uploads"),
      VeryfrontError,
      "Invalid upload path",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });
});

describe("uploadsCommand", () => {
  it("rejects unusable subcommand arguments as invalid-argument usage errors", async () => {
    const cases: Array<[ParsedArgs, string]> = [
      [{ _: ["uploads", "list"], limit: "many" }, "Invalid uploads list arguments:"],
      [{ _: ["uploads", "put"] }, "Invalid uploads put arguments:"],
      [{ _: ["uploads", "delete"] }, "Invalid uploads delete arguments:"],
    ];
    for (const [args, expectedDetail] of cases) {
      const error = await assertRejects(
        () => uploadsCommand(args),
        VeryfrontError,
        expectedDetail,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
    }
  });
});

describe("downloadUploadToFile", () => {
  it("preserves the write failure when closing and removing temporary data also fail", async () => {
    const primary = new Error("private download write failed");
    let closes = 0;
    let removals = 0;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const failure = await assertRejects(
      () =>
        writeStreamExclusive(
          source,
          undefined,
          async () => ({
            write() {
              return Promise.reject(primary);
            },
            close() {
              closes++;
              throw new Error("temporary handle cleanup failed");
            },
          }),
          async () => {
            removals++;
            throw new Error("temporary file cleanup failed");
          },
        ),
      Error,
      "private download write failed",
    );
    assertEquals(failure, primary);
    assertEquals({ closes, removals, locked: source.locked }, {
      closes: 1,
      removals: 1,
      locked: false,
    });
  });

  it("closes private download streams through captured promise intrinsics", async () => {
    const nativeThen = Promise.prototype.then;
    let hooked = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const writing = writeStreamExclusive(
      source,
      undefined,
      async () => ({
        write(chunk: Uint8Array) {
          return Promise.resolve(chunk.byteLength);
        },
        close() {
          Promise.prototype.then = function () {
            hooked = true;
            Promise.prototype.then = nativeThen;
            return new Promise(() => {});
          };
        },
      }),
      async () => {},
    );
    let timeoutReached!: () => void;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutReached = () => resolve("timeout");
    });
    const timeout = setTimeout(() => timeoutReached(), 30);
    try {
      const result = await Promise.race([writing, timeoutPromise]);
      assertEquals(result, 1);
      assertEquals(hooked, false);
      assertEquals(source.locked, false);
    } finally {
      clearTimeout(timeout);
      Promise.prototype.then = nativeThen;
    }
  });

  it("promotes and cleans private downloads without project filesystem hooks", async () => {
    const tempDir = await makeTempDir();
    const nodeFs = (await import("node:fs")).default;
    const nodePromises = (await import("node:fs/promises")).default;
    const prototype = Object.getPrototypeOf(createFileSystem());
    const privateMethods = ["writeFileStream", "promoteStreamFile", "removeStreamFile"] as const;
    const originalMethods = privateMethods.map((name) =>
      Object.getOwnPropertyDescriptor(prototype, name)!
    );
    const originalRegExpExec = RegExp.prototype.exec;
    const originalRandomUUID = crypto.randomUUID;
    const originalNodeRename = nodeFs.rename;
    const originalNodeUnlink = nodeFs.unlink;
    const originalPromiseRename = nodePromises.rename;
    const originalPromiseRemove = nodePromises.rm;
    const deno = typeof Deno === "undefined" ? undefined : Deno;
    const originalRename = deno?.rename;
    const originalRemove = deno?.remove;
    let hookCalls = 0;
    const untrustedHook = (..._args: unknown[]): never => {
      hookCalls++;
      throw new Error("untrusted filesystem hook");
    };
    try {
      await mkdir(`${tempDir}/blocked`);
      RegExp.prototype.exec = function (input: string) {
        if (input.length === 36) hookCalls++;
        return Reflect.apply(originalRegExpExec, this, [input]);
      };
      crypto.randomUUID = () => {
        hookCalls++;
        return "x/../../known-file" as ReturnType<typeof crypto.randomUUID>;
      };
      for (const name of privateMethods) Reflect.set(prototype, name, untrustedHook);
      Reflect.set(nodeFs, "rename", untrustedHook);
      Reflect.set(nodeFs, "unlink", untrustedHook);
      nodePromises.rename = untrustedHook;
      nodePromises.rm = untrustedHook;
      if (deno) {
        deno.rename = untrustedHook;
        deno.remove = untrustedHook;
      }
      const client = createMockClient({
        getStream: () => Promise.resolve(new Response("private report").body!),
      });
      const result = await downloadUploadToFile(client, "my-project", "file", tempDir);
      assertEquals(await readTextFile(result.localPath), "private report");
      await assertRejects(() => downloadUploadToFile(client, "my-project", "blocked", tempDir));
      const names = [];
      for await (const entry of readDir(tempDir)) names.push(entry.name);
      names.sort();
      assertEquals(names, ["blocked", "file"]);
      assertEquals(hookCalls, 0);
    } finally {
      privateMethods.forEach((name, index) =>
        Object.defineProperty(prototype, name, originalMethods[index]!)
      );
      RegExp.prototype.exec = originalRegExpExec;
      crypto.randomUUID = originalRandomUUID;
      nodeFs.rename = originalNodeRename;
      nodeFs.unlink = originalNodeUnlink;
      nodePromises.rename = originalPromiseRename;
      nodePromises.rm = originalPromiseRemove;
      if (deno && originalRename && originalRemove) {
        deno.rename = originalRename;
        deno.remove = originalRemove;
      }
      await remove(tempDir, { recursive: true });
    }
  });

  denoOnlyIt(
    "keeps late-imported download bytes behind the host atomic stream capability",
    async () => {
      const script = await Deno.makeTempFile({ prefix: "vf-upload-late-import-", suffix: ".ts" });
      try {
        await Deno.writeTextFile(
          script,
          `import { assertEquals } from "#veryfront/testing/assert.ts";
import { createFileSystem } from "veryfront/platform";

const fs = createFileSystem();
const prototype = Object.getPrototypeOf(fs);
const streamDescriptor = Object.getOwnPropertyDescriptor(prototype, "writeFileStream")!;
const streamAtomicDescriptor = Object.getOwnPropertyDescriptor(prototype, "writeFileStreamAtomic");
const originalRandomUUID = crypto.randomUUID;
const originalRegExpExec = RegExp.prototype.exec;
const originalOpen = Deno.open;
const originalRemove = Deno.remove;
const originalRename = Deno.rename;
const originalWrite = Deno.FsFile.prototype.write;
const originalClose = Deno.FsFile.prototype.close;
let interceptedPrivateBytes = false;
let interceptedNonce = false;
let interceptedNative = false;
const interceptStream = async (path: string, source: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
  const [privateCopy, forwarded] = source.tee();
  interceptedPrivateBytes = await new Response(privateCopy).text() === "PRIVATE_PROBE_BYTES";
  return Reflect.apply(streamDescriptor.value, fs, [path, forwarded, signal]);
};
try {
  Object.defineProperty(prototype, "writeFileStream", {
    ...streamDescriptor,
    value: interceptStream,
  });
  Object.defineProperty(prototype, "writeFileStreamAtomic", {
    configurable: true,
    value: interceptStream,
  });
  crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000" as ReturnType<typeof crypto.randomUUID>;
  RegExp.prototype.exec = function (input: string) {
    if (input.length === 36) interceptedNonce = true;
    return Reflect.apply(originalRegExpExec, this, [input]);
  };
  const { downloadUploadToFile } = await import("#cli/commands/uploads/command");
  crypto.randomUUID = () => {
    interceptedNonce = true;
    return "00000000-0000-4000-8000-000000000000" as ReturnType<typeof crypto.randomUUID>;
  };
  Deno.open = async (path, options) => {
    interceptedNative = true;
    return await originalOpen(path, options);
  };
  Deno.remove = async (path, options) => {
    interceptedNative = true;
    await originalRemove(path, options);
  };
  Deno.rename = async (from, to) => {
    interceptedNative = true;
    await originalRename(from, to);
  };
  Deno.FsFile.prototype.write = function (chunk) {
    interceptedNative = true;
    return Reflect.apply(originalWrite, this, [chunk]);
  };
  Deno.FsFile.prototype.close = function () {
    interceptedNative = true;
    Reflect.apply(originalClose, this, []);
  };
  const output = await Deno.makeTempDir({ prefix: "vf-upload-late-import-" });
  try {
    const result = await downloadUploadToFile({
      getStream: () => Promise.resolve(new Response("PRIVATE_PROBE_BYTES").body!),
    } as never, "probe-project", "probe.txt", output);
    assertEquals(await Deno.readTextFile(result.localPath), "PRIVATE_PROBE_BYTES");
    assertEquals(interceptedPrivateBytes, false);
    assertEquals(interceptedNonce, false);
    assertEquals(interceptedNative, false);
  } finally {
    await originalRemove(output, { recursive: true });
  }
} finally {
  Object.defineProperty(prototype, "writeFileStream", streamDescriptor);
  if (streamAtomicDescriptor) {
    Object.defineProperty(prototype, "writeFileStreamAtomic", streamAtomicDescriptor);
  } else {
    delete (prototype as { writeFileStreamAtomic?: unknown }).writeFileStreamAtomic;
  }
  crypto.randomUUID = originalRandomUUID;
  RegExp.prototype.exec = originalRegExpExec;
  Deno.open = originalOpen;
  Deno.remove = originalRemove;
  Deno.rename = originalRename;
  Deno.FsFile.prototype.write = originalWrite;
  Deno.FsFile.prototype.close = originalClose;
}
`,
        );
        const result = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--config=deno.json",
            "--no-check",
            "--allow-all",
            script,
          ],
          cwd: Deno.cwd(),
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(
          result.code,
          0,
          `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`,
        );
      } finally {
        await remove(script);
      }
    },
  );
  nodeOnlyIt(
    "keeps late-imported download bytes behind the host atomic stream capability on Node",
    async () => {
      const tempDir = await makeTempDir();
      const script = `${tempDir}/late-import-probe.mjs`;
      try {
        await writeTextFile(
          script,
          `import { createFileSystem } from "veryfront/platform";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fs = createFileSystem();
const prototype = Object.getPrototypeOf(fs);
const streamDescriptor = Object.getOwnPropertyDescriptor(prototype, "writeFileStream");
const streamAtomicDescriptor = Object.getOwnPropertyDescriptor(prototype, "writeFileStreamAtomic");
const originalRandomUUID = crypto.randomUUID;
const originalRegExpExec = RegExp.prototype.exec;
const nodeFs = process.getBuiltinModule("node:fs");
const originalNodeOperations = {
  open: nodeFs.open,
  write: nodeFs.write,
  close: nodeFs.close,
  unlink: nodeFs.unlink,
  rename: nodeFs.rename,
};
let interceptedPrivateBytes = false;
let interceptedNonce = false;
let interceptedNative = false;
const interceptStream = async (path, source, signal) => {
  const [privateCopy, forwarded] = source.tee();
  interceptedPrivateBytes = await new Response(privateCopy).text() === "PRIVATE_PROBE_BYTES";
  if (!streamDescriptor) throw new Error("writeFileStream descriptor unavailable");
  return Reflect.apply(streamDescriptor.value, fs, [path, forwarded, signal]);
};
const interceptNative = (name) =>
  function (...args) {
    interceptedNative = true;
    return Reflect.apply(originalNodeOperations[name], this, args);
  };
try {
  if (streamDescriptor) {
    Object.defineProperty(prototype, "writeFileStream", {
      ...streamDescriptor,
      value: interceptStream,
    });
  }
  Object.defineProperty(prototype, "writeFileStreamAtomic", {
    configurable: true,
    value: interceptStream,
  });
  crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";
  RegExp.prototype.exec = function (input) {
    if (input.length === 36) interceptedNonce = true;
    return Reflect.apply(originalRegExpExec, this, [input]);
  };
  for (const name of Object.keys(originalNodeOperations)) {
    nodeFs[name] = interceptNative(name);
  }
  const { downloadUploadToFile } = await import("#cli/commands/uploads/command");
  crypto.randomUUID = () => {
    interceptedNonce = true;
    return "00000000-0000-4000-8000-000000000000";
  };
  const output = await mkdtemp(join(tmpdir(), "vf-upload-node-late-import-"));
  try {
    const result = await downloadUploadToFile({
      getStream: () => Promise.resolve(new Response("PRIVATE_PROBE_BYTES").body),
    }, "probe-project", "probe.txt", output);
    const text = await readFile(result.localPath, "utf8");
    if (text !== "PRIVATE_PROBE_BYTES") throw new Error(\`unexpected output: \${text}\`);
    if (interceptedPrivateBytes) throw new Error("project stream hook observed private bytes");
    if (interceptedNonce) throw new Error("project nonce hook observed private path nonce");
    if (interceptedNative) throw new Error("project native hook observed private fs operation");
    console.log(JSON.stringify({ interceptedPrivateBytes, interceptedNonce, interceptedNative }));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
} finally {
  if (streamDescriptor) Object.defineProperty(prototype, "writeFileStream", streamDescriptor);
  if (streamAtomicDescriptor) {
    Object.defineProperty(prototype, "writeFileStreamAtomic", streamAtomicDescriptor);
  } else {
    delete prototype.writeFileStreamAtomic;
  }
  crypto.randomUUID = originalRandomUUID;
  RegExp.prototype.exec = originalRegExpExec;
  for (const [name, method] of Object.entries(originalNodeOperations)) {
    nodeFs[name] = method;
  }
}
`,
        );
        const childProcess = await import("node:child_process");
        const currentProcess = globalThis.process;
        const result = await new Promise<{
          code: number | null;
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          const child = childProcess.spawn(currentProcess.execPath, [
            "--import",
            "./tests/node/resolver.mjs",
            script,
          ], {
            cwd: currentProcess.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => stdout += chunk);
          child.stderr.on("data", (chunk: string) => stderr += chunk);
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stdout, stderr }));
        });
        assertEquals(result.code, 0, `${result.stdout}${result.stderr}`);
        assertStringIncludes(
          result.stdout,
          '{"interceptedPrivateBytes":false,"interceptedNonce":false,"interceptedNative":false}',
        );
      } finally {
        await remove(tempDir, { recursive: true });
      }
    },
  );
  it("downloads authenticated API content into the output directory", async () => {
    const tempDir = await makeTempDir();
    let requestedPath = "";
    try {
      const client = createMockClient({
        getStream: (path) => {
          requestedPath = path;
          return Promise.resolve(new Response("quarterly report").body!);
        },
      });
      const result = await downloadUploadToFile(client, "my-project", "contracts/q1.pdf", tempDir);
      assertEquals(requestedPath, "/projects/my-project/uploads/contracts%2Fq1.pdf");
      assertEquals(await readTextFile(result.localPath), "quarterly report");
      assertEquals(result.bytes, 16);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
  it("validates the output path before opening the download stream", async () => {
    let opened = false;
    const client = createMockClient({
      getStream: () => {
        opened = true;
        return Promise.resolve(new ReadableStream<Uint8Array>());
      },
    });
    await assertRejects(() => downloadUploadToFile(client, "my-project", "file", "/"));
    assertEquals(opened, false);
  });
  it("downloads filenames near the filesystem component length limit", async () => {
    const tempDir = await makeTempDir();
    const filename = `${"a".repeat(220)}.pdf`;
    try {
      const client = createMockClient({
        getStream: () => Promise.resolve(new Response("content").body!),
      });
      const result = await downloadUploadToFile(client, "my-project", filename, tempDir);
      assertEquals(await readTextFile(result.localPath), "content");
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
  it("preserves the existing output and removes temporary data on a download failure", async () => {
    const tempDir = await makeTempDir();
    await writeTextFile(`${tempDir}/file`, "original");
    try {
      const client = createMockClient({
        getStream: () =>
          Promise.resolve(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("partial"));
              },
              pull(controller) {
                controller.error(new Error("download interrupted"));
              },
            }),
          ),
      });
      await assertRejects(
        () => downloadUploadToFile(client, "my-project", "file", tempDir),
        Error,
        "download interrupted",
      );
      assertEquals(await readTextFile(`${tempDir}/file`), "original");
      const names = [];
      for await (const entry of readDir(tempDir)) names.push(entry.name);
      assertEquals(names, ["file"]);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("uploadLocalFileToUploads", () => {
  it("creates an upload URL then PUTs the local file bytes", async () => {
    const tempDir = await makeTempDir();
    const localPath = `${tempDir}/q1.pdf`;
    let metadataPath = "";
    let metadataBody: unknown = null;
    let uploadedMethod = "";
    let uploadedHeaders = new Headers();
    let uploadedBytes = 0;

    await writeTextFile(localPath, "quarterly report");

    installMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url === "https://signed.example.test/upload/q1.pdf") {
        uploadedMethod = init?.method ?? "GET";
        uploadedHeaders = new Headers(init?.headers);
        uploadedBytes = init?.body instanceof Uint8Array ? init.body.byteLength : 0;
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      const client = createMockClient({
        post: (path, body) => {
          metadataPath = path;
          metadataBody = body;
          return Promise.resolve({
            file_upload_url: "https://signed.example.test/upload/q1.pdf",
            file_path: "project-123/contracts/q1.pdf",
            upload_id: "upload-123",
            required_headers: {
              "Content-Type": "application/pdf",
            },
          });
        },
      });

      const result = await uploadLocalFileToUploads(
        client,
        "my-project",
        "contracts/q1.pdf",
        localPath,
      );

      assertEquals(metadataPath, "/projects/my-project/uploads");
      assertEquals(metadataBody, {
        file_path: "contracts/q1.pdf",
        content_type: "application/pdf",
        size: 16,
      });
      assertEquals(uploadedMethod, "PUT");
      assertEquals(uploadedHeaders.get("Content-Type"), "application/pdf");
      assertEquals(uploadedBytes, 16);
      assertEquals(result.upload_id, "upload-123");
    } finally {
      restoreMockFetch();
      await remove(tempDir, { recursive: true });
    }
  });
});

describe("deleteUpload", () => {
  it("deletes an upload by path", async () => {
    let capturedPath = "";
    const client = createMockClient({
      delete: (path) => {
        capturedPath = path;
        return Promise.resolve({});
      },
    });

    await deleteUpload(client, "my-project", "contracts/q1.pdf");

    assertEquals(capturedPath, "/projects/my-project/uploads/contracts%2Fq1.pdf");
  });
});
