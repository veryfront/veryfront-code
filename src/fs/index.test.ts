import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as fsModule from "./index.ts";
import * as publicFsModule from "veryfront/fs";
import * as compatFsModule from "#veryfront/platform/compat/fs.ts";
import * as pathModule from "#veryfront/platform/compat/path/index.ts";
import * as processModule from "#veryfront/platform/compat/process.ts";

const expectedRuntimeExports = [
  "basename",
  "createFileSystem",
  "cwd",
  "dirname",
  "exists",
  "extname",
  "join",
  "mkdir",
  "readDir",
  "readTextFile",
  "realPath",
  "remove",
  "resolve",
  "writeTextFile",
].sort();

describe("fs/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/fs", () => {
    assertEquals(Object.keys(fsModule).sort(), expectedRuntimeExports);
  });

  it("keeps filesystem, path, and cwd re-exports wired to their source modules", () => {
    assertEquals(fsModule.createFileSystem, compatFsModule.createFileSystem);
    assertEquals(fsModule.readTextFile, compatFsModule.readTextFile);
    assertEquals(fsModule.writeTextFile, compatFsModule.writeTextFile);
    assertEquals(fsModule.mkdir, compatFsModule.mkdir);
    assertEquals(fsModule.exists, compatFsModule.exists);
    assertEquals(fsModule.remove, compatFsModule.remove);
    assertEquals(fsModule.readDir, compatFsModule.readDir);
    assertEquals(fsModule.realPath, compatFsModule.realPath);
    assertEquals(fsModule.basename, pathModule.basename);
    assertEquals(fsModule.dirname, pathModule.dirname);
    assertEquals(fsModule.extname, pathModule.extname);
    assertEquals(fsModule.join, pathModule.join);
    assertEquals(fsModule.resolve, pathModule.resolve);
    assertEquals(fsModule.cwd, processModule.cwd);
  });

  it("keeps the public barrel intentionally slim", () => {
    assertEquals("readFile" in fsModule, false);
    assertEquals("stat" in fsModule, false);
    assertEquals("makeTempDir" in fsModule, false);
    assertEquals("relative" in fsModule, false);
    assertEquals("sep" in fsModule, false);
    assertEquals("chdir" in fsModule, false);
  });

  it("keeps the documented veryfront/fs entrypoint aligned with the barrel module", () => {
    assertEquals(Object.keys(publicFsModule).sort(), expectedRuntimeExports);
    assertEquals(publicFsModule.readTextFile, fsModule.readTextFile);
    assertEquals(publicFsModule.resolve, fsModule.resolve);
    assertEquals(publicFsModule.cwd, fsModule.cwd);
  });
});
