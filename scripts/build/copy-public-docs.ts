import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { releaseDocsInputs } from "../docs/release-inputs.ts";
import { parse } from "#std/yaml/parse";

export const PUBLIC_DOC_ROOTS = [
  "getting-started",
  "guides",
  "concepts",
  "api-reference",
] as const;

interface PublicPage {
  path: string;
  title: string;
  description: string;
}

function publicPageMetadata(text: string, file: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!header) {
    throw new Error(`Missing public documentation metadata: ${file}`);
  }
  const metadata = parse(header[1]);
  if (
    !metadata || typeof metadata !== "object" || Array.isArray(metadata)
  ) {
    throw new Error(`Invalid public documentation metadata: ${file}`);
  }
  const fields = metadata as Record<string, unknown>;
  if (
    fields.draft === true || fields.internal === true ||
    fields.status === "draft"
  ) return undefined;
  if (typeof fields.title !== "string" || !fields.title.trim()) {
    throw new Error(`Missing public documentation title: ${file}`);
  }
  return fields as Record<string, unknown> & { title: string };
}

async function assertSourceSnapshot(repositoryRoot: string, revision: string) {
  const head = await new Deno.Command("git", {
    args: ["-C", repositoryRoot, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const changes = await new Deno.Command("git", {
    args: [
      "-C",
      repositoryRoot,
      "diff",
      "--quiet",
      revision,
      "--",
      "docs",
      "assets/product-covers",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (
    !head.success ||
    new TextDecoder().decode(head.stdout).trim() !== revision ||
    !changes.success
  ) {
    throw new Error("Documentation source snapshot changed after pinning");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    return false;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function removeStaging(staging: string): Promise<void> {
  try {
    await removeIfExists(staging);
  } catch (error) {
    console.error(
      `Unable to remove documentation staging directory: ${staging}`,
      error,
    );
  }
}

/** Package only public Markdown. The maintainer docs index and internal roots never enter npm. */
export async function copyPublicDocs(
  repositoryRoot: string,
  packageRoot: string,
  version: string,
  identity?: { repository: string; revision: string; dirty: boolean },
): Promise<PublicPage[]> {
  if (!version.trim()) {
    throw new Error("Public documentation requires a package version");
  }
  const sourceRoot = await Deno.realPath(join(repositoryRoot, "docs"));
  await Deno.mkdir(packageRoot, { recursive: true });
  packageRoot = await Deno.realPath(packageRoot);
  const destination = resolve(packageRoot, "docs");
  const destinationRelative = relative(sourceRoot, destination);
  if (
    !isAbsolute(destinationRelative) && destinationRelative !== ".." &&
    !destinationRelative.startsWith(`..${sep}`)
  ) {
    throw new Error(
      "Package docs output must be outside the authored docs directory",
    );
  }
  const staging = await Deno.makeTempDir({
    dir: packageRoot,
    prefix: ".docs-",
  });
  const pages: PublicPage[] = [];
  const assertReleaseInput = identity && !identity.dirty
    ? await releaseDocsInputs(repositoryRoot, identity.revision)
    : undefined;
  try {
    const copyDirectory = async (directory: string): Promise<void> => {
      for await (const entry of Deno.readDir(directory)) {
        const file = join(directory, entry.name);
        if (entry.isSymlink) {
          throw new Error(`Public docs cannot contain symlinks: ${file}`);
        }
        if (entry.isDirectory) {
          await copyDirectory(file);
          continue;
        }
        if (
          !entry.isFile || entry.name === "README.md" ||
          !/\.mdx?$/.test(entry.name)
        ) continue;
        const bytes = await Deno.readFile(file);
        assertReleaseInput?.(file, bytes);
        const text = new TextDecoder().decode(bytes);
        const fields = publicPageMetadata(text, file);
        if (!fields) continue;
        const publicPath = relative(sourceRoot, file).replaceAll("\\", "/");
        const target = join(staging, publicPath);
        await Deno.mkdir(join(target, ".."), { recursive: true });
        await Deno.writeTextFile(target, text);
        pages.push({
          path: publicPath,
          title: fields.title,
          description: typeof fields.description === "string"
            ? fields.description
            : "",
        });
      }
    };
    for (const name of PUBLIC_DOC_ROOTS) {
      const directory = join(sourceRoot, name);
      if ((await Deno.realPath(directory)) !== directory) {
        throw new Error(`Invalid public docs root: ${directory}`);
      }
      await copyDirectory(directory);
    }
    pages.sort((a, b) => a.path.localeCompare(b.path));
    const escapeLabel = (value: string) =>
      value.replace(/[[\]\\]/g, String.raw`\$&`).replace(/[\r\n]+/g, " ");
    const sections = PUBLIC_DOC_ROOTS.map((section) => {
      const entries = pages.filter((page) =>
        page.path.startsWith(`${section}/`)
      );
      return `## ${section.replaceAll("-", " ")}\n\n${
        entries.map((page) => `- [${escapeLabel(page.title)}](./${page.path})`)
          .join("\n")
      }`;
    });
    await Deno.writeTextFile(
      join(staging, "README.md"),
      `# Veryfront Code documentation\n\nThese docs ship with veryfront ${version}. Read the relevant guide before changing framework code in a consuming project. Start with [Local quickstart](./getting-started/quickstart.md), then use the task guides or generated API reference below.\n\nEdit source comments and regenerate API reference; do not edit generated reference directly. Website docs may describe a newer version.\n\n${
        sections.join("\n\n")
      }\n`,
    );
    // The task index and the website consume the same installed Markdown files.
    // Extra artifact metadata does not change the agent-facing version/pages index.
    const mode = identity && !identity.dirty ? "release" : "local";
    for (const directory of PUBLIC_DOC_ROOTS) {
      await Deno.mkdir(join(staging, directory), { recursive: true });
    }
    const assetSource = join(
      await Deno.realPath(repositoryRoot),
      "assets/product-covers",
    );
    const copyAssets = async (from: string, to: string) => {
      if (await Deno.realPath(from) !== resolve(from)) {
        throw new Error("Public docs assets cannot use symlinks");
      }
      await Deno.mkdir(to, { recursive: true });
      for await (const entry of Deno.readDir(from)) {
        if (entry.isSymlink) {
          throw new Error("Public docs assets cannot use symlinks");
        }
        if (entry.isDirectory) {
          await copyAssets(join(from, entry.name), join(to, entry.name));
        } else if (
          entry.isFile && /\.(?:png|jpe?g|svg|webp|gif|avif)$/i.test(entry.name)
        ) {
          const file = join(from, entry.name);
          const bytes = await Deno.readFile(file);
          assertReleaseInput?.(file, bytes);
          await Deno.writeFile(join(to, entry.name), bytes);
        }
      }
    };
    await Deno.mkdir(join(staging, "assets"), { recursive: true });
    const hasAssets = await pathExists(assetSource);
    if (hasAssets) {
      await copyAssets(assetSource, join(staging, "assets/product-covers"));
    }
    await Deno.writeTextFile(
      join(staging, "config.json"),
      JSON.stringify(
        {
          mode,
          mounts: [{
            product: "code",
            root: ".",
            directories: PUBLIC_DOC_ROOTS,
            version,
            ...(pages.some((page) =>
                page.path === "getting-started/overview.mdx"
              )
              ? { landing: "getting-started/overview.mdx" }
              : {}),
          }],
          assetRoots: { code: "./assets" },
          redirectFiles: [],
        },
        null,
        2,
      ) + "\n",
    );
    const files: { path: string; sha256: string }[] = [];
    const fingerprint = async (directory: string) => {
      for await (const entry of Deno.readDir(directory)) {
        const file = join(directory, entry.name);
        if (entry.isDirectory) await fingerprint(file);
        else {files.push({
            path: relative(staging, file).replaceAll("\\", "/"),
            sha256: createHash("sha256").update(await Deno.readFile(file))
              .digest("hex"),
          });}
      }
    };
    await fingerprint(staging);
    await Deno.writeTextFile(
      join(staging, "manifest.json"),
      JSON.stringify(
        {
          version,
          pages,
          mode,
          sources: [{
            product: "code",
            version,
            ...(identity ?? { repository: "", revision: "", dirty: true }),
          }],
          files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
        },
        null,
        2,
      ) + "\n",
    );
    if (identity && !identity.dirty) {
      await assertSourceSnapshot(repositoryRoot, identity.revision);
    }
    await removeIfExists(destination);
    await Deno.rename(staging, destination);
    return pages;
  } finally {
    await removeStaging(staging);
  }
}
