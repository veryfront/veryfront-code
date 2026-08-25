import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  hasWindowsLikePath,
  portableBasename,
  portableDirname,
  portableExtname,
  portableFormat,
  portableIsAbsolute,
  portableJoin,
  portableNormalize,
  portableParse,
  portableRelative,
  portableResolve,
} from "./portable.ts";

describe("platform/compat/path/portable", () => {
  it("distinguishes UNC paths from redundant POSIX roots", () => {
    assertEquals(hasWindowsLikePath("//server/share/file.ts"), false);
    assertEquals(hasWindowsLikePath(String.raw`\\server\share\file.ts`), true);
    assertEquals(hasWindowsLikePath("///tmp/file.ts"), false);
    assertEquals(hasWindowsLikePath("////tmp/file.ts"), false);
    assertEquals(portableNormalize("///tmp/file.ts", true), "/tmp/file.ts");
  });

  it("normalizes POSIX joins without a native path module", () => {
    assertEquals(
      portableJoin(["/workspace", ".", "src", "..", "test"], false),
      "/workspace/test",
    );
    assertEquals(portableJoin([""], false), "/");
  });

  it("preserves Windows drive and UNC roots", () => {
    assertEquals(
      portableNormalize("D:\\workspace\\src\\..\\test", true),
      "D:/workspace/test",
    );
    assertEquals(
      portableNormalize("\\\\server\\share\\project\\..\\src", true),
      "//server/share/src",
    );
    assertEquals(portableDirname("D:\\file.ts", true), "D:/");
  });

  it("extracts portable path components", () => {
    assertEquals(
      portableBasename("D:\\workspace\\file.test.ts", ".ts", true),
      "file.test",
    );
    assertEquals(
      portableExtname("D:\\workspace\\file.test.ts", true),
      ".ts",
    );
    assertEquals(portableExtname("/workspace/.gitignore", false), "");
    assertEquals(portableBasename("/workspace/file.ts", "file.ts", false), "file.ts");
    assertEquals(portableBasename("file.ts", "file.ts", false), "");
    assertEquals(portableBasename("file.ts/", "file.ts", false), "file.ts");
  });

  it("resolves and relativizes absolute paths", () => {
    assertEquals(
      portableResolve(["/workspace/src", "..", "test"], false),
      "/workspace/test",
    );
    assertEquals(
      portableResolve(["//server/share/project", ".."], true),
      "//server/share/",
    );
    assertEquals(
      portableRelative("C:/workspace", "D:/project", true),
      "D:/project",
    );
    assertEquals(
      portableRelative("/workspace/src", "/workspace/test", false),
      "../test",
    );
  });

  it("keeps path operations stable after post-import prototype poisoning", () => {
    const includes = Object.getOwnPropertyDescriptor(String.prototype, "includes")!;
    const replaceAll = Object.getOwnPropertyDescriptor(String.prototype, "replaceAll")!;
    const replace = Object.getOwnPropertyDescriptor(String.prototype, "replace")!;
    const startsWith = Object.getOwnPropertyDescriptor(String.prototype, "startsWith")!;
    const endsWith = Object.getOwnPropertyDescriptor(String.prototype, "endsWith")!;
    const split = Object.getOwnPropertyDescriptor(String.prototype, "split")!;
    const slice = Object.getOwnPropertyDescriptor(String.prototype, "slice")!;
    const lastIndexOf = Object.getOwnPropertyDescriptor(String.prototype, "lastIndexOf")!;
    const toLowerCase = Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase")!;
    const push = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
    const pop = Object.getOwnPropertyDescriptor(Array.prototype, "pop")!;
    const join = Object.getOwnPropertyDescriptor(Array.prototype, "join")!;
    const arraySlice = Object.getOwnPropertyDescriptor(Array.prototype, "slice")!;
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const exec = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")!;
    const poisoned = () => {
      throw new Error("poisoned path intrinsic invoked");
    };
    let actual: unknown;

    try {
      Object.defineProperty(String.prototype, "includes", { ...includes, value: poisoned });
      Object.defineProperty(String.prototype, "replaceAll", { ...replaceAll, value: poisoned });
      Object.defineProperty(String.prototype, "replace", { ...replace, value: poisoned });
      Object.defineProperty(String.prototype, "startsWith", { ...startsWith, value: poisoned });
      Object.defineProperty(String.prototype, "endsWith", { ...endsWith, value: poisoned });
      Object.defineProperty(String.prototype, "split", { ...split, value: poisoned });
      Object.defineProperty(String.prototype, "slice", { ...slice, value: poisoned });
      Object.defineProperty(String.prototype, "lastIndexOf", { ...lastIndexOf, value: poisoned });
      Object.defineProperty(String.prototype, "toLowerCase", { ...toLowerCase, value: poisoned });
      Object.defineProperty(Array.prototype, "push", { ...push, value: poisoned });
      Object.defineProperty(Array.prototype, "pop", { ...pop, value: poisoned });
      Object.defineProperty(Array.prototype, "join", { ...join, value: poisoned });
      Object.defineProperty(Array.prototype, "slice", { ...arraySlice, value: poisoned });
      Object.defineProperty(Array.prototype, Symbol.iterator, { ...iterator, value: poisoned });
      Object.defineProperty(RegExp.prototype, "exec", { ...exec, value: poisoned });

      actual = {
        normalized: portableNormalize("D:\\workspace\\src\\..\\test", true),
        joined: portableJoin(["/workspace", "src", "..", "test"], false),
        relative: portableRelative("/workspace/src", "/workspace/test", false),
        resolved: portableResolve(["/workspace/src", "..", "test"], false),
        basename: portableBasename("D:\\workspace\\file.test.ts", ".ts", true),
        extname: portableExtname("/workspace/file.test.ts", false),
        dirname: portableDirname("D:\\file.ts", true),
        absolute: portableIsAbsolute("//server/share", true),
        parsed: portableParse("D:\\workspace\\src\\file.ts", true),
        formatted: portableFormat(portableParse("D:\\workspace\\src\\file.ts", true), true),
      };
    } finally {
      Object.defineProperty(String.prototype, "includes", includes);
      Object.defineProperty(String.prototype, "replaceAll", replaceAll);
      Object.defineProperty(String.prototype, "replace", replace);
      Object.defineProperty(String.prototype, "startsWith", startsWith);
      Object.defineProperty(String.prototype, "endsWith", endsWith);
      Object.defineProperty(String.prototype, "split", split);
      Object.defineProperty(String.prototype, "slice", slice);
      Object.defineProperty(String.prototype, "lastIndexOf", lastIndexOf);
      Object.defineProperty(String.prototype, "toLowerCase", toLowerCase);
      Object.defineProperty(Array.prototype, "push", push);
      Object.defineProperty(Array.prototype, "pop", pop);
      Object.defineProperty(Array.prototype, "join", join);
      Object.defineProperty(Array.prototype, "slice", arraySlice);
      Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
      Object.defineProperty(RegExp.prototype, "exec", exec);
    }

    assertEquals(actual, {
      normalized: "D:/workspace/test",
      joined: "/workspace/test",
      relative: "../test",
      resolved: "/workspace/test",
      basename: "file.test",
      extname: ".ts",
      dirname: "D:/",
      absolute: true,
      parsed: { root: "D:/", dir: "D:/workspace/src", base: "file.ts", ext: ".ts", name: "file" },
      formatted: "D:/workspace/src/file.ts",
    }, "every portable path helper must survive poisoned intrinsics");
  });

  it("recognizes portable absolute paths", () => {
    assertEquals(portableIsAbsolute("/workspace", false), true);
    assertEquals(portableIsAbsolute("D:/workspace", true), true);
    assertEquals(portableIsAbsolute("//server/share", true), true);
    assertEquals(portableIsAbsolute("workspace", false), false);
  });

  it("parses and formats Windows paths", () => {
    const parsed = portableParse("D:\\workspace\\src\\file.ts", true);
    assertEquals(parsed, {
      root: "D:/",
      dir: "D:/workspace/src",
      base: "file.ts",
      ext: ".ts",
      name: "file",
    });
    assertEquals(portableFormat(parsed, true), "D:/workspace/src/file.ts");
    assertEquals(
      portableFormat(
        { root: "", dir: "src", base: "", ext: ".js", name: "index" },
        false,
      ),
      "src/index.js",
    );
    assertEquals(
      portableFormat(
        { root: "", dir: "src", base: "", ext: "js", name: "index" },
        false,
      ),
      "src/index.js",
    );
  });
});
