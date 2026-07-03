const REACT_ROOT_PREFIX = "react@";
const REACT_DOM_ROOT_PREFIX = "react-dom@";
const SCHEDULER_ROOT_PREFIX = "scheduler@";

export function normalizeEsmShReactNpmShims(root: string): number {
  let patchedCount = 0;

  for (const entry of Deno.readDirSync(root)) {
    if (
      entry.isFile && entry.name.startsWith(REACT_ROOT_PREFIX) &&
      entry.name.endsWith(".js")
    ) {
      patchedCount += writeNpmShim(
        `${root}/${entry.name}`,
        "react",
        entry.name,
      );
      continue;
    }

    if (
      entry.isFile && entry.name.startsWith(REACT_DOM_ROOT_PREFIX) &&
      entry.name.endsWith(".js")
    ) {
      // The chat UI portals import `react-dom` (createPortal), so dnt now
      // emits a top-level react-dom root file too — shim it like react's.
      patchedCount += writeNpmShim(
        `${root}/${entry.name}`,
        "react-dom",
        entry.name,
      );
      continue;
    }

    if (
      entry.isFile && entry.name.startsWith(SCHEDULER_ROOT_PREFIX) &&
      entry.name.endsWith(".js")
    ) {
      patchedCount += writeNpmShim(
        `${root}/${entry.name}`,
        "scheduler",
        entry.name,
      );
      continue;
    }

    if (!entry.isDirectory) continue;

    if (entry.name.startsWith(REACT_ROOT_PREFIX)) {
      const packageRoot = `${root}/${entry.name}`;
      patchedCount += writeNpmShimIfExists(
        `${packageRoot}/jsx-runtime.js`,
        "react/jsx-runtime",
        `${entry.name}/jsx-runtime.js`,
      );
      patchedCount += writeNpmShimIfExists(
        `${packageRoot}/jsx-dev-runtime.js`,
        "react/jsx-dev-runtime",
        `${entry.name}/jsx-dev-runtime.js`,
      );
      continue;
    }

    if (entry.name.startsWith(REACT_DOM_ROOT_PREFIX)) {
      const packageRoot = `${root}/${entry.name}`;
      patchedCount += writeNpmShimIfExists(
        `${packageRoot}/client.js`,
        "react-dom/client",
        `${entry.name}/client.js`,
      );
      patchedCount += writeNpmShimIfExists(
        `${packageRoot}/server.js`,
        "react-dom/server",
        `${entry.name}/server.js`,
      );
    }
  }

  assertNoReactInternalPackageImports(root);
  return patchedCount;
}

function writeNpmShimIfExists(
  path: string,
  specifier: string,
  label: string,
): number {
  try {
    Deno.statSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }

  return writeNpmShim(path, specifier, label);
}

function writeNpmShim(path: string, specifier: string, label: string): number {
  const current = Deno.readTextFileSync(path);
  const patched =
    `/* npm package shim for esm.sh ${label} */\nexport * from "${specifier}";\nexport { default } from "${specifier}";\n`;
  if (current === patched) return 0;

  Deno.writeTextFileSync(path, patched);
  return 1;
}

function assertNoReactInternalPackageImports(root: string): void {
  const remaining = findReactInternalPackageImports(root);
  if (remaining.length === 0) return;

  throw new Error(
    `Generated npm package still imports esm.sh React internals that Node package exports do not expose: ${
      remaining.join(", ")
    }`,
  );
}

function findReactInternalPackageImports(root: string): string[] {
  const matches: string[] = [];
  for (const path of walkFiles(root)) {
    if (!path.endsWith(".js")) continue;

    const content = Deno.readTextFileSync(path);
    if (content.includes('from "react/') && content.includes("/es2022/")) {
      matches.push(path);
      continue;
    }

    if (content.includes('from "react-dom/') && content.includes("/es2022/")) {
      matches.push(path);
      continue;
    }

    if (content.includes('from "scheduler/') && content.includes("/es2022/")) {
      matches.push(path);
    }
  }

  return matches;
}

function* walkFiles(root: string): Generator<string> {
  for (const entry of Deno.readDirSync(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkFiles(path);
      continue;
    }

    if (entry.isFile) {
      yield path;
    }
  }
}
