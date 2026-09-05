import { assertEquals, assertRejects } from "#std/assert";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFileInsideProject } from "../../../scripts/codemods/migrate-esm-sh-imports.ts";

Deno.test("project writes stay bound to the file opened before a path swap", async () => {
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
