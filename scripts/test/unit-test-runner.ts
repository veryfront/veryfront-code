import { parse } from "#babel/parser";
import { walk } from "#std/fs/walk";

interface AstNode {
  type: string;
  [key: string]: unknown;
}

export type SerialCwdTestCategory = "incidental" | "platform-contract";

export interface SerialCwdTestManifestEntry {
  category: SerialCwdTestCategory;
  reason: string;
}

export type SerialCwdTestManifest = Readonly<
  Record<string, SerialCwdTestManifestEntry>
>;

export interface UnitTestFilePartition {
  parallelFiles: string[];
  serialCwdFiles: string[];
}

export type UnitTestLane = "parallel" | "serial-cwd";

export const SERIAL_CWD_TEST_DIRECTIVE = "@veryfront-test-serial-cwd";

/**
 * Reviewed exceptions that require the process-global working directory.
 *
 * Static discovery must match this manifest exactly. New mutations therefore
 * fail closed instead of silently moving themselves out of the parallel lane.
 */
export const SERIAL_CWD_UNIT_TESTS: SerialCwdTestManifest = Object.freeze({
  "cli/app/operations/project-creation.test.ts": {
    category: "incidental",
    reason: "Exercises project creation from the active CLI directory",
  },
  "cli/commands/issues/command.test.ts": {
    category: "incidental",
    reason: "Exercises issue commands against a temporary active project",
  },
  "cli/commands/schedule/handler.test.ts": {
    category: "incidental",
    reason: "Exercises schedule discovery from a temporary active project",
  },
  "cli/commands/skills/validate.test.ts": {
    category: "incidental",
    reason: "Exercises skill validation from a temporary active project",
  },
  "cli/commands/webhook/handler.test.ts": {
    category: "incidental",
    reason: "Exercises webhook discovery from a temporary active project",
  },
  "cli/router.test.ts": {
    category: "incidental",
    reason: "Exercises router project resolution from the active directory",
  },
  "src/platform/compat/process.test.ts": {
    category: "platform-contract",
    reason: "Verifies the public cross-runtime chdir contract",
  },
  "src/server/handlers/studio/bridge-modules.handler.test.ts": {
    category: "incidental",
    reason: "Exercises bridge module resolution from a temporary directory",
  },
});

const UNIT_TEST_ROOTS = ["src", "cli"] as const;
const UNIT_TEST_ENV = {
  DENO_TESTING: "1",
  VF_DISABLE_LRU_INTERVAL: "1",
  SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
  REVALIDATION_PER_PROJECT_LIMIT: "0",
  NODE_ENV: "production",
  LOG_FORMAT: "text",
};

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function visitAst(value: unknown, visitor: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visitAst(child, visitor);
    return;
  }
  if (!isAstNode(value)) return;

  visitor(value);
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "loc" || key === "leadingComments" || key === "trailingComments"
    ) continue;
    if (typeof child === "object" && child !== null) visitAst(child, visitor);
  }
}

function nodeName(value: unknown): string | undefined {
  if (!isAstNode(value)) return undefined;
  if (value.type === "Identifier" && typeof value.name === "string") {
    return value.name;
  }
  if (value.type === "StringLiteral" && typeof value.value === "string") {
    return value.value;
  }
  return undefined;
}

function memberPropertyName(node: AstNode): string | undefined {
  if (
    node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression"
  ) {
    return undefined;
  }
  return nodeName(node.property);
}

function objectPatternSelectsChdir(value: unknown): boolean {
  if (
    !isAstNode(value) || value.type !== "ObjectPattern" ||
    !Array.isArray(value.properties)
  ) {
    return false;
  }
  return value.properties.some((property) =>
    isAstNode(property) && property.type === "ObjectProperty" &&
    nodeName(property.key) === "chdir"
  );
}

/** Detect direct CWD primitives and the canonical imported chdir facade. */
export function sourceMutatesProcessCwd(
  source: string,
  path = "unit-test.ts",
): boolean {
  if (source.includes(SERIAL_CWD_TEST_DIRECTIVE)) return true;
  if (!source.includes("chdir")) return false;

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      plugins: ["typescript", "jsx"],
      sourceFilename: path,
      sourceType: "unambiguous",
    });
  } catch (error) {
    throw new Error(
      `Unable to classify CWD mutation in ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let mutatesCwd = false;
  visitAst(ast, (node) => {
    if (mutatesCwd) return;

    if (memberPropertyName(node) === "chdir") {
      mutatesCwd = true;
      return;
    }
    if (
      (node.type === "CallExpression" ||
        node.type === "OptionalCallExpression") &&
      nodeName(node.callee) === "chdir"
    ) {
      mutatesCwd = true;
      return;
    }
    if (
      node.type === "ImportSpecifier" && nodeName(node.imported) === "chdir"
    ) {
      mutatesCwd = true;
      return;
    }
    if (
      node.type === "VariableDeclarator" && objectPatternSelectsChdir(node.id)
    ) {
      mutatesCwd = true;
    }
  });
  return mutatesCwd;
}

export function isUnitTestFile(path: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  return /\.test\.tsx?$/.test(normalizedPath) &&
    !/\.integration\.test\.tsx?$/.test(normalizedPath) &&
    !normalizedPath.startsWith("src/workflow/__tests__/");
}

export async function collectUnitTestFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of UNIT_TEST_ROOTS) {
    for await (
      const entry of walk(root, { includeDirs: false, exts: [".ts", ".tsx"] })
    ) {
      const path = entry.path.replaceAll("\\", "/");
      if (isUnitTestFile(path)) files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export async function partitionUnitTestFiles(
  files: readonly string[],
  options: {
    manifest?: SerialCwdTestManifest;
    readTextFile?: (path: string) => Promise<string>;
  } = {},
): Promise<UnitTestFilePartition> {
  const manifest = options.manifest ?? SERIAL_CWD_UNIT_TESTS;
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  const normalizedFiles = [...files].map((path) => path.replaceAll("\\", "/"))
    .sort();
  const fileSet = new Set(normalizedFiles);
  const detected = new Set<string>();

  for (const path of normalizedFiles) {
    if (sourceMutatesProcessCwd(await readTextFile(path), path)) {
      detected.add(path);
    }
  }

  const unreviewed = [...detected].filter((path) => !(path in manifest));
  const stale = Object.keys(manifest).filter((path) =>
    !fileSet.has(path) || !detected.has(path)
  );
  if (unreviewed.length > 0 || stale.length > 0) {
    const details = [
      ...unreviewed.map((path) => `unreviewed CWD mutation: ${path}`),
      ...stale.map((path) => `stale serial-CWD manifest entry: ${path}`),
    ];
    throw new Error(
      `Serial-CWD unit-test classification is out of date:\n${
        details.join("\n")
      }`,
    );
  }

  return {
    parallelFiles: normalizedFiles.filter((path) => !detected.has(path)),
    serialCwdFiles: normalizedFiles.filter((path) => detected.has(path)),
  };
}

export function buildUnitTestCommandArgs(
  files: readonly string[],
  mode: UnitTestLane,
  forwardedArgs: readonly string[] = [],
): string[] {
  return [
    "test",
    "--preload=src/schemas/_test-setup.ts",
    ...(mode === "parallel"
      ? ["--preload=scripts/test/forbid-parallel-cwd-mutation.ts", "--parallel"]
      : []),
    "--no-check",
    "--allow-all",
    "--v8-flags=--max-old-space-size=8192",
    "--ignore=tests",
    "--ignore=src/workflow/__tests__",
    "--unstable-worker-options",
    "--unstable-net",
    ...forwardedArgs,
    ...files,
  ];
}

async function runDenoTestLane(
  files: readonly string[],
  mode: UnitTestLane,
  cwd: string,
  forwardedArgs: readonly string[],
): Promise<number> {
  if (files.length === 0) return 0;
  const child = new Deno.Command(Deno.execPath(), {
    args: buildUnitTestCommandArgs(files, mode, forwardedArgs),
    cwd,
    env: UNIT_TEST_ENV,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  return (await child.status).code;
}

export async function runUnitTests(
  forwardedArgs: readonly string[] = Deno.args,
): Promise<number> {
  const cwd = Deno.cwd();
  const partition = await partitionUnitTestFiles(await collectUnitTestFiles());
  console.log(
    `Unit-test lanes: ${partition.parallelFiles.length} parallel, ` +
      `${partition.serialCwdFiles.length} serial CWD-mutating modules`,
  );

  const parallelExitCode = await runDenoTestLane(
    partition.parallelFiles,
    "parallel",
    cwd,
    forwardedArgs,
  );
  if (parallelExitCode !== 0) return parallelExitCode;
  return await runDenoTestLane(
    partition.serialCwdFiles,
    "serial-cwd",
    cwd,
    forwardedArgs,
  );
}

if (import.meta.main) {
  Deno.exit(await runUnitTests());
}
