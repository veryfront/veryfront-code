import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFileInsideProject } from "../../../scripts/codemods/migrate-esm-sh-imports.ts";
import {
  openPinnedPosixFile,
  readPinnedDirectory,
} from "../../../scripts/codemods/pinned-directory.ts";

describe("pinned file operations", () => {
  it("uses legacy stat bindings when modern glibc symbols are unavailable", async () => {
    if (Deno.build.os !== "linux") return;
    const root = await Deno.realPath(await makeTempDir());
    const originalDlopen = Deno.dlopen;
    const legacyCalls = new Set<string>();
    try {
      await Deno.writeTextFile(`${root}/app.ts`, "original");
      Deno.dlopen = ((path: string | URL, symbols: Deno.ForeignLibraryInterface) => {
        const bindings = { ...symbols };
        for (const name of ["fstat", "fstatat"]) {
          if (name in bindings) {
            bindings[name] = { ...bindings[name], name: "veryfront_missing_stat_symbol" };
          }
        }
        const library = originalDlopen(path, bindings);
        return new Proxy(library, {
          get(nativeLibrary, key) {
            if (key === "symbols") {
              return new Proxy(nativeLibrary.symbols, {
                get(symbols, symbol) {
                  const fn = Reflect.get(symbols, symbol);
                  if (typeof fn !== "function") return fn;
                  return (...values: unknown[]) => {
                    if (symbol === "legacyFstat" || symbol === "legacyFstatat") {
                      legacyCalls.add(symbol);
                      assertEquals(values[0], Deno.build.arch === "x86_64" ? 1 : 0);
                    }
                    const result = Reflect.apply(fn, undefined, values);
                    if (symbol === "readdir_r" && values[1] instanceof Uint8Array) {
                      // DT_UNKNOWN forces the fstatat fallback as well.
                      values[1][18] = 0;
                    }
                    return result;
                  };
                },
              });
            }
            const value = Reflect.get(nativeLibrary, key, nativeLibrary);
            return typeof value === "function" ? value.bind(nativeLibrary) : value;
          },
        });
      }) as typeof Deno.dlopen;
      const names: string[] = [];
      for await (const entry of readPinnedDirectory(root, root)) names.push(entry.name);
      assertEquals(names, ["app.ts"]);
      await writeTextFileInsideProject(`${root}/app.ts`, root, "updated");
      assertEquals(await Deno.readTextFile(`${root}/app.ts`), "updated");
      assertEquals([...legacyCalls].sort(), ["legacyFstat", "legacyFstatat"]);
    } finally {
      Deno.dlopen = originalDlopen;
      await Deno.remove(root, { recursive: true });
    }
  });
  it("preserves access through execute-only POSIX ancestors", async () => {
    if (Deno.build.os === "windows") return;
    const base = await Deno.realPath(await makeTempDir());
    const ancestor = `${base}/ancestor`;
    const root = `${ancestor}/project`;
    try {
      await Deno.mkdir(root, { recursive: true });
      await Deno.writeTextFile(`${root}/app.ts`, "original");
      await Deno.chmod(ancestor, 0o111);
      const names: string[] = [];
      for await (const entry of readPinnedDirectory(root, root)) names.push(entry.name);
      assertEquals(names, ["app.ts"]);
      await writeTextFileInsideProject(`${root}/app.ts`, root, "updated");
      assertEquals(await Deno.readTextFile(`${root}/app.ts`), "updated");
    } finally {
      await Deno.chmod(ancestor, 0o700);
      await Deno.remove(base, { recursive: true });
    }
  });
  it("rejects symlinks in the POSIX project root ancestors", async () => {
    if (Deno.build.os === "windows") return;
    const base = await Deno.realPath(await makeTempDir());
    try {
      await Deno.mkdir(`${base}/outside/project`, { recursive: true });
      await Deno.writeTextFile(`${base}/outside/project/app.ts`, "outside");
      await Deno.symlink(`${base}/outside`, `${base}/linked`);
      const root = `${base}/linked/project`;
      await assertRejects(async () => {
        for await (const _entry of readPinnedDirectory(root, root)) { /* drain */ }
      });
      await assertRejects(async () => {
        const file = openPinnedPosixFile(`${root}/created.ts`, root, "wx+");
        await file.close();
      });
      assertEquals(
        Array.from(Deno.readDirSync(`${base}/outside/project`)).map((entry) => entry.name),
        ["app.ts"],
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
  it("Windows manifest creation does not follow a swapped parent junction", async () => {
    if (Deno.build.os !== "windows") return;
    const base = await makeTempDir();
    const project = `${base}/project`;
    const moved = `${base}/original`;
    const outside = `${base}/outside`;
    const target = `${project}/package.json`;
    await Deno.mkdir(project);
    await Deno.mkdir(outside);
    const projectRoot = await Deno.realPath(project);
    const originalDlopen = Deno.dlopen;
    let swapped = false;
    try {
      Deno.dlopen = ((...args: Parameters<typeof Deno.dlopen>) => {
        const library = Reflect.apply(originalDlopen, Deno, args);
        return new Proxy(library, {
          get(nativeLibrary, key) {
            if (key === "symbols") {
              return new Proxy(nativeLibrary.symbols, {
                get(symbols, symbol) {
                  const fn = Reflect.get(symbols, symbol);
                  if (symbol !== "NtCreateFile") return fn;
                  return (...values: unknown[]) => {
                    // FILE_CREATE: swap after opening the parent, immediately
                    // before the native operation creates the leaf file.
                    if (!swapped && values[7] === 2) {
                      Deno.renameSync(project, moved);
                      swapped = true;
                      Deno.symlinkSync(outside, project, { type: "junction" });
                    }
                    return Reflect.apply(fn, undefined, values);
                  };
                },
              });
            }
            const value = Reflect.get(nativeLibrary, key, nativeLibrary);
            return typeof value === "function" ? value.bind(nativeLibrary) : value;
          },
        });
      }) as typeof Deno.dlopen;
      await assertRejects(() =>
        writeTextFileInsideProject(target, projectRoot, "{}\n", {
          allowMissing: true,
          requireMissing: true,
        })
      );
      assertEquals(swapped, true);
      assertEquals(Array.from(Deno.readDirSync(outside)), []);
    } finally {
      Deno.dlopen = originalDlopen;
      if (swapped) await Deno.remove(project);
      await Deno.remove(base, { recursive: true });
    }
  });

  it("project writes stay bound to the file opened before a path swap", async () => {
    if (Deno.build.os === "windows") return;

    const project = await makeTempDir();
    const outside = await makeTempDir();
    const target = `${project}/app.ts`;
    const originalEntry = `${project}/app.original.ts`;
    const outsideFile = `${outside}/outside.ts`;
    const originalDlopen = Deno.dlopen;
    let swapped = false;
    try {
      await Deno.writeTextFile(target, "original");
      await Deno.writeTextFile(outsideFile, "outside");

      Deno.dlopen = ((...args: Parameters<typeof Deno.dlopen>) => {
        const library = Reflect.apply(originalDlopen, Deno, args);
        return new Proxy(library, {
          get(nativeLibrary, key) {
            if (key === "symbols") {
              return new Proxy(nativeLibrary.symbols, {
                get(symbols, symbol) {
                  const fn = Reflect.get(symbols, symbol);
                  if (symbol !== "ftruncate") return fn;
                  return (...values: unknown[]) => {
                    if (!swapped) {
                      swapped = true;
                      Deno.renameSync(target, originalEntry);
                      Deno.symlinkSync(outsideFile, target);
                    }
                    return Reflect.apply(fn, undefined, values);
                  };
                },
              });
            }
            const value = Reflect.get(nativeLibrary, key, nativeLibrary);
            return typeof value === "function" ? value.bind(nativeLibrary) : value;
          },
        });
      }) as typeof Deno.dlopen;

      const projectRoot = await Deno.realPath(project);
      await assertRejects(
        () => writeTextFileInsideProject(target, projectRoot, "updated"),
        Error,
        "destination path changed",
      );

      assertEquals(await Deno.readTextFile(outsideFile), "outside");
      assertEquals(await Deno.readTextFile(originalEntry), "updated");
    } finally {
      Deno.dlopen = originalDlopen;
      await Deno.remove(project, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  });
});
