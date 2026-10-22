import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "#std/yaml/parse";
import { prepareRcBuildVersion } from "../ci/prepare-rc-build.ts";

const PUBLIC_ROOTS: Record<string, string[]> = {
  code: ["getting-started", "guides", "concepts", "api-reference"],
  cloud: ["cloud"],
  agent: ["agent"],
  studio: ["studio"],
  platform: ["platform"],
};
const ASSET_FILE = /\.(?:png|jpe?g|svg|webp|gif|avif|woff2?)$/i;
const sha256 = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

interface PackageDocsOptions {
  repository: string;
  product: string;
  name: string;
  version: string;
  output: string;
  mode: "local" | "release";
  revision?: string;
}

async function git(root: string, args: string[], trim = true) {
  const result = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error("Unable to establish documentation source identity");
  }
  const value = new TextDecoder().decode(result.stdout);
  return trim ? value.trim() : value;
}

/** Permit only the existing deterministic RC version preparation, never arbitrary source edits. */
export async function docsSourceIdentity(
  repository: string,
  buildVersion?: string,
) {
  const root = await Deno.realPath(repository);
  const revision = await git(root, ["rev-parse", "HEAD"]);
  const status = await git(root, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ], false);
  let dirty = Boolean(status.trim());
  let versionPreparation: "ci-rc" | undefined;
  const versionFiles = [
    "deno.json",
    "src/utils/version-constant.ts",
    "scripts/deno.lock",
  ];
  const changed = status.trimEnd().split("\n").filter(Boolean);
  if (
    dirty && buildVersion &&
    changed.every((line) =>
      !line.startsWith("??") && versionFiles.includes(line.slice(3))
    )
  ) {
    const base = new Map<string, string>();
    for (const file of versionFiles) {
      base.set(file, await git(root, ["show", `HEAD:${file}`], false));
    }
    const manifest = JSON.parse(base.get("deno.json")!);
    const suffix = typeof manifest.version === "string" &&
        buildVersion.startsWith(`${manifest.version}.`)
      ? buildVersion.slice(manifest.version.length + 1)
      : "";
    if (/^[1-9]\d*$/.test(suffix) && /^\d+\.\d+\.\d+-/.test(manifest.version)) {
      const temporary = await Deno.makeTempDir({ prefix: "docs-rc-identity-" });
      try {
        for (const [file, source] of base) {
          await Deno.mkdir(path.dirname(path.join(temporary, file)), {
            recursive: true,
          });
          await Deno.writeTextFile(path.join(temporary, file), source);
        }
        await prepareRcBuildVersion({
          rootDir: temporary,
          version: buildVersion,
        });
        const matches = await Promise.all(
          versionFiles.map(async (file) =>
            await Deno.readTextFile(path.join(root, file)) ===
              await Deno.readTextFile(path.join(temporary, file))
          ),
        );
        if (matches.every(Boolean)) {
          dirty = false;
          versionPreparation = "ci-rc";
        }
      } finally {
        await Deno.remove(temporary, { recursive: true });
      }
    }
  }
  const remote = (await git(root, ["remote", "get-url", "origin"]))
    .replace(/^(https?:\/\/)[^/@]+@/, "$1").replace(/\.git$/, "");
  return {
    revision,
    dirty,
    repository: remote,
    ...(versionPreparation ? { versionPreparation } : {}),
  };
}

/** Publishable content only; the owning product's source and dependencies never enter this package. */
export async function packagePublicDocs(options: PackageDocsOptions) {
  const directories = PUBLIC_ROOTS[options.product];
  if (!directories || !/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(options.name)) {
    throw new Error("Invalid documentation package identity");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new Error("Invalid documentation package version");
  }
  const repository = await Deno.realPath(options.repository);
  if (await git(repository, ["rev-parse", "--show-toplevel"]) !== repository) {
    throw new Error("Select the owning repository root");
  }
  const revision = await git(repository, ["rev-parse", "HEAD"]);
  const dirty = Boolean(
    await git(repository, ["status", "--porcelain", "--untracked-files=all"]),
  );
  if (
    options.mode === "release" &&
    (dirty || options.revision !== revision || !/^[a-f0-9]{40}$/.test(revision))
  ) {
    throw new Error(
      "Release documentation requires a clean pinned product checkout",
    );
  }
  const remote = (await git(repository, ["remote", "get-url", "origin"]))
    .replace(/^(https?:\/\/)[^/@]+@/, "$1").replace(/\.git$/, "");
  const root = path.join(
    repository,
    options.product === "code" ? "docs" : "docs/public",
  );
  if (await Deno.realPath(root) !== root) {
    throw new Error("Public documentation cannot use symlinks");
  }
  const outputParent = path.dirname(path.resolve(options.output));
  await Deno.mkdir(outputParent, { recursive: true });
  const output = path.join(
    await Deno.realPath(outputParent),
    path.basename(options.output),
  );
  if (output === repository || output.startsWith(`${repository}/`)) {
    throw new Error(
      "Documentation package output must be outside its source repository",
    );
  }
  try {
    await Deno.lstat(output);
    throw new Error("Documentation package output already exists");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  let catalogRevision: string | undefined;
  const generationInputs = new Map<string, string>();
  async function publicationReady() {
    const marker = path.join(
      path.dirname(root),
      `.${path.basename(root)}.publishing`,
    );
    try {
      await Deno.stat(marker);
      throw new Error("Public documentation publication is in progress");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  await publicationReady();
  if (options.product === "cloud" && options.mode === "release") {
    const generationFile = path.join(root, "generation.json");
    const catalogFile = path.join(root, "catalog-source.json");
    const generationBytes = await Deno.readFile(generationFile);
    const catalogBytes = await Deno.readFile(catalogFile);
    const generation = JSON.parse(new TextDecoder().decode(generationBytes));
    const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
    generationInputs.set(generationFile, sha256(generationBytes));
    generationInputs.set(catalogFile, sha256(catalogBytes));
    if (
      generation.sourceRevision !== revision || generation.sourceDirty !== false
    ) throw new Error("Cloud reference must match its clean pinned API source");
    if (
      !catalog.complete || catalog.sourceDirty !== false ||
      !/^[a-f0-9]{40}$/.test(catalog.sourceRevision)
    ) throw new Error("Cloud catalog requires a clean pinned Code source");
    catalogRevision = catalog.sourceRevision;
  }
  const stage = await Deno.makeTempDir({
    dir: outputParent,
    prefix: ".docs-package-",
  });
  const contentRoot = path.join(stage, "content");
  const records: { path: string; sha256: string }[] = [];
  const inputs = new Map<string, string>(generationInputs);
  let pages = 0;
  async function copy(from: string, relative: string, bytes: Uint8Array) {
    const target = path.join(contentRoot, relative);
    await Deno.mkdir(path.dirname(target), { recursive: true });
    await Deno.writeFile(target, bytes);
    const hash = sha256(bytes);
    records.push({ path: relative, sha256: hash });
    inputs.set(from, hash);
  }
  try {
    async function walk(directory: string, assets: boolean) {
      if (await Deno.realPath(directory) !== directory) {
        throw new Error("Public docs paths cannot use symlinks");
      }
      for await (const entry of Deno.readDir(directory)) {
        const file = path.join(directory, entry.name);
        if (entry.isSymlink) {
          throw new Error("Public docs cannot contain symlinks");
        }
        if (entry.isDirectory) await walk(file, assets);
        else if (
          entry.isFile &&
          (assets
            ? ASSET_FILE.test(entry.name)
            : /\.mdx?$/.test(entry.name) && entry.name !== "README.md")
        ) {
          const bytes = await Deno.readFile(file);
          if (!assets) {
            const text = new TextDecoder().decode(bytes);
            const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
            if (!header) {
              throw new Error(`Missing public docs frontmatter: ${file}`);
            }
            const fields = parse(header[1]) as Record<string, unknown>;
            if (
              !fields || typeof fields !== "object" || Array.isArray(fields)
            ) throw new Error("Invalid public docs frontmatter");
            if (
              fields.draft === true || fields.internal === true ||
              fields.status === "draft"
            ) continue;
            if (typeof fields.title !== "string" || !fields.title.trim()) {
              throw new Error("Missing public docs title");
            }
            pages++;
          }
          const relative = assets
            ? `${options.product}/assets/${
              path.relative(assetSource, file).split(path.sep).join("/")
            }`
            : `${options.product}/${
              path.relative(root, file).split(path.sep).join("/")
            }`;
          await copy(file, relative, bytes);
        }
      }
    }
    const assetSource = path.join(
      repository,
      options.product === "code" ? "assets" : "docs/public/assets",
    );
    for (const directory of directories) {
      await Deno.mkdir(path.join(contentRoot, options.product, directory), {
        recursive: true,
      });
      await walk(path.join(root, directory), false);
    }
    await Deno.mkdir(path.join(contentRoot, options.product, "assets"), {
      recursive: true,
    });
    await walk(assetSource, true);
    const redirectsFile = options.product === "cloud"
      ? path.join(root, "navigation.json")
      : path.join(root, "redirects.json");
    let redirects: { source: string; destination: string }[] = [];
    try {
      const raw = await Deno.readFile(redirectsFile);
      const value = JSON.parse(new TextDecoder().decode(raw));
      redirects = Array.isArray(value) ? value : value.redirects;
      if (
        !Array.isArray(redirects) ||
        redirects.some((entry) =>
          !entry || typeof entry.source !== "string" ||
          typeof entry.destination !== "string" ||
          !entry.source.startsWith("/") || entry.source.startsWith("//") ||
          !entry.destination.startsWith("/") ||
          entry.destination.startsWith("//")
        )
      ) throw new Error("Invalid public documentation redirects");
      inputs.set(redirectsFile, sha256(raw));
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotFound) || options.product === "cloud"
      ) throw error;
    }
    const config = {
      mode: options.mode,
      mounts: [{
        product: options.product,
        root: `./${options.product}`,
        directories,
        version: options.version,
        ...(options.product === "code"
          ? { landing: "getting-started/overview.mdx" }
          : {}),
      }],
      assetRoots: { [options.product]: `./${options.product}/assets` },
      redirectFiles: ["./redirects.json"],
    };
    for (
      const [filename, value] of [["config.json", config], [
        "redirects.json",
        redirects,
      ]] as const
    ) {
      const bytes = new TextEncoder().encode(
        JSON.stringify(value, null, 2) + "\n",
      );
      await Deno.writeFile(path.join(contentRoot, filename), bytes);
      records.push({ path: filename, sha256: sha256(bytes) });
    }
    for (const [file, hash] of inputs) {
      if (sha256(await Deno.readFile(file)) !== hash) {
        throw new Error("Documentation source changed during packaging");
      }
    }
    await publicationReady();
    if (
      await git(repository, ["rev-parse", "HEAD"]) !== revision ||
      (options.mode === "release" &&
        Boolean(
          await git(repository, [
            "status",
            "--porcelain",
            "--untracked-files=all",
          ]),
        ))
    ) throw new Error("Product checkout changed during packaging");
    const manifest = {
      mode: options.mode,
      pages,
      sources: [{
        product: options.product,
        revision,
        dirty,
        repository: remote,
        version: options.version,
        ...(catalogRevision ? { catalogSourceRevision: catalogRevision } : {}),
      }],
      files: records.sort((a, b) => a.path.localeCompare(b.path)),
    };
    await Deno.writeTextFile(
      path.join(contentRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await Deno.writeTextFile(
      path.join(stage, "package.json"),
      JSON.stringify(
        {
          name: options.name,
          version: options.version,
          description: `Public ${options.product} documentation`,
          repository: { type: "git", url: remote },
          type: "module",
          files: ["content"],
          exports: {
            "./package.json": "./package.json",
            "./config.json": "./content/config.json",
            "./manifest.json": "./content/manifest.json",
            "./*": "./content/*",
          },
          publishConfig: { access: "public" },
        },
        null,
        2,
      ) + "\n",
    );
    await Deno.rename(stage, output);
    return { output, pages, revision, dirty };
  } finally {
    try {
      await Deno.remove(stage, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

if (import.meta.main) {
  const values = new Map<string, string>();
  const allowed = new Set([
    "repository",
    "product",
    "name",
    "version",
    "output",
    "mode",
    "revision",
  ]);
  for (let i = 0; i < Deno.args.length; i += 2) {
    if (!Deno.args[i].startsWith("--") || !Deno.args[i + 1]) {
      throw new Error("Expected --option value");
    }
    const key = Deno.args[i].slice(2);
    if (!allowed.has(key) || values.has(key)) {
      throw new Error("Unknown or duplicate documentation option");
    }
    values.set(key, Deno.args[i + 1]);
  }
  for (const key of ["repository", "product", "name", "version", "output"]) {
    if (!values.has(key)) throw new Error(`Missing --${key}`);
  }
  const mode = values.get("mode") ?? "release";
  if (mode !== "local" && mode !== "release") {
    throw new Error("Invalid documentation mode");
  }
  console.log(JSON.stringify(
    await packagePublicDocs({
      repository: values.get("repository")!,
      product: values.get("product")!,
      name: values.get("name")!,
      version: values.get("version")!,
      output: values.get("output")!,
      revision: values.get("revision"),
      mode,
    }),
    null,
    2,
  ));
}
