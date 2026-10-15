import { fileURLToPath } from "node:url";
import { readTypeScriptDecoratorOptions } from "#veryfront/extensions/bundler/typescript-config.ts";
import { parseExtensionManifest } from "#veryfront/extensions/manifest-reader.ts";
import { createFileSystem, realPath } from "#veryfront/platform/compat/fs.ts";
import { dirname, isAbsolute, join, resolve } from "#veryfront/compat/path/index.ts";
import { computeHash } from "./utils/index.ts";

/** Fingerprints the inputs and resolution directories of one compiled script graph. */
export class ScriptCompilationInputs {
  private readonly files = new Map<string, string | undefined>();
  private readonly directories = new Map<string, string | undefined>();
  private readonly fs = createFileSystem();
  reusable = true;
  private root?: Promise<string>;

  constructor(private readonly projectDir: string) {}

  private async file(path: string): Promise<string | undefined> {
    return await this.fs.exists(path)
      ? await computeHash(await this.fs.readTextFile(path))
      : undefined;
  }

  private async directory(path: string): Promise<string | undefined> {
    if (!await this.fs.exists(path)) return undefined;
    const entries: string[] = [];
    for await (const entry of this.fs.readDir(path)) {
      let target: string | undefined;
      if (entry.isSymlink) {
        try {
          target = await realPath(join(path, entry.name));
        } catch {
          // An unverifiable link disables reuse; compilation still owns dependency errors.
          this.reusable = false;
        }
      }
      if (
        path.endsWith("/node_modules") && entry.name.startsWith("@") &&
        (entry.isDirectory || (target && (await this.fs.stat(target)).isDirectory))
      ) {
        entries.push(JSON.stringify([entry.name, await this.directory(join(path, entry.name))]));
      }
      entries.push(
        JSON.stringify([entry.name, entry.isDirectory, entry.isFile, entry.isSymlink, target]),
      );
    }
    return await computeHash(entries.sort().join("\n"));
  }

  private async configurations(folder: string): Promise<void> {
    while (true) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const path = join(folder, name);
        if (this.files.has(path)) continue;
        this.files.set(path, await this.file(path));
        if (this.files.get(path) === undefined) continue;
        // Reuse the bundler's bounded inheritance reader and fingerprint every configuration read.
        try {
          await readTypeScriptDecoratorOptions({
            configPath: path,
            readTextFile: async (file) => {
              const contents = await this.fs.readTextFile(file);
              this.files.set(file, await computeHash(contents));
              const config = parseExtensionManifest<
                { extends?: unknown; compilerOptions?: { paths?: unknown; baseUrl?: unknown } }
              >(contents, "jsonc", "tsconfig.json");
              const parents = typeof config.extends === "string"
                ? [config.extends]
                : Array.isArray(config.extends)
                ? config.extends
                : [];
              if (
                parents.some((parent) =>
                  typeof parent !== "string" || !/^(?:\.{1,2}\/|\/)/.test(parent)
                )
              ) {
                this.reusable = false;
              }
              // Alias fallback candidates can exist outside the loaded graph. Recompile these graphs.
              if (config.compilerOptions?.paths || config.compilerOptions?.baseUrl) {
                this.reusable = false;
              }
              return contents;
            },
          });
        } catch {
          // A surrounding config may not be effective for this file. Let the compiler
          // own config diagnostics and disable reuse when its inputs cannot be verified.
          this.reusable = false;
        }
      }
      const parent = dirname(folder);
      if (parent === folder) break;
      folder = parent;
    }
  }

  async record(path: string, contents: string): Promise<void> {
    if (!this.reusable) return;
    this.files.set(path, await computeHash(contents));
    await this.recordResolution(path);
  }

  async recordResolution(path: string): Promise<void> {
    if (!this.reusable) return;
    try {
      await this.captureResolution(path);
    } catch {
      // Unverifiable optimization inputs disable reuse; the bundler owns read failures.
      this.reusable = false;
    }
  }

  async verifyFileLookup(specifier: string, resolveDir: string): Promise<void> {
    if (!this.reusable) return;
    try {
      const base = await realPath(resolveDir);
      const target = specifier.startsWith("file:")
        ? fileURLToPath(specifier)
        : isAbsolute(specifier)
        ? specifier
        : resolve(base, specifier);
      if (!await this.fs.exists(target) || await realPath(target) !== target) this.reusable = false;
    } catch {
      this.reusable = false;
    }
  }

  private async captureResolution(path: string): Promise<void> {
    let root: string;
    let folder: string;
    try {
      root = await (this.root ??= realPath(this.projectDir));
      folder = await realPath(dirname(path));
    } catch {
      this.reusable = false;
      return;
    }
    await this.configurations(folder);
    let withinPackage = true;
    while (true) {
      const candidate = join(folder, "node_modules");
      if (!this.directories.has(candidate)) {
        this.directories.set(candidate, await this.directory(candidate));
      }
      if (
        (withinPackage || folder === root || folder.startsWith(`${root}/`)) &&
        !this.directories.has(folder)
      ) {
        this.directories.set(folder, await this.directory(folder));
      }
      const manifest = join(folder, "package.json");
      if (!this.files.has(manifest)) this.files.set(manifest, await this.file(manifest));
      if (folder === root || this.files.get(manifest) !== undefined) withinPackage = false;
      const parent = dirname(folder);
      if (parent === folder) break;
      folder = parent;
    }
  }

  async unchanged(): Promise<boolean> {
    if (!this.reusable || !this.root) return false;
    try {
      if (await realPath(this.projectDir) !== await this.root) return false;
    } catch {
      return false;
    }
    try {
      for (const [path, expected] of this.files) {
        if (await this.file(path) !== expected) return false;
      }
      for (const [path, expected] of this.directories) {
        if (await this.directory(path) !== expected) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
