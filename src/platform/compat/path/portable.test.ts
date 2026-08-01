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
    assertEquals(hasWindowsLikePath("//server/share/file.ts"), true);
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
