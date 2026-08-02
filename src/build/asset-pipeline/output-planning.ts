import { basename, dirname, isAbsolute, resolve } from "#veryfront/compat/path/index.ts";
import { isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { isContainedAssetPath } from "../utils/asset-utils.ts";
import { hasControlCharacters } from "../utils/string-validation.ts";

/** A build stage and the output tree it intends to publish. */
export interface AssetStageOutputPlan {
  readonly stage: string;
  readonly projectDir: string;
  readonly outputDir: string;
}

interface CanonicalAssetStageOutput {
  readonly stage: string;
  readonly projectDir: string;
  readonly outputDir: string;
  readonly comparisonProjectDir: string;
  readonly comparisonOutputDir: string;
}

function assertSafePath(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(`${label} must be a safe non-empty path`);
  }
}

function comparisonPath(path: string): string {
  return resolve(path)
    .replaceAll("\\", "/")
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
}

function isComparisonPathContained(basePath: string, candidatePath: string): boolean {
  return candidatePath === basePath || candidatePath.startsWith(
    basePath.endsWith("/") ? basePath : `${basePath}/`,
  );
}

/**
 * Resolve a path through its nearest existing ancestor.
 *
 * Build outputs commonly do not exist yet. Resolving the nearest existing
 * ancestor still exposes symlink aliases before a stage creates or replaces
 * any output.
 */
export async function canonicalizePlannedAssetPath(path: string): Promise<string> {
  assertSafePath(path, "Asset output path");
  const absolutePath = resolve(path);

  try {
    return resolve(await realPath(absolutePath));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const suffix: string[] = [];
  let candidate = absolutePath;
  while (true) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new TypeError(`Cannot resolve asset output path: ${path}`);
    }
    suffix.unshift(basename(candidate));
    try {
      return resolve(await realPath(parent), ...suffix);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      candidate = parent;
    }
  }
}

async function canonicalizePlan(
  plan: AssetStageOutputPlan,
): Promise<CanonicalAssetStageOutput> {
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    throw new TypeError("Asset stage output plan must be an object");
  }
  assertSafePath(plan.stage, "Asset stage name");
  assertSafePath(plan.projectDir, `Asset pipeline ${plan.stage} project directory`);
  assertSafePath(plan.outputDir, `Asset pipeline ${plan.stage} output directory`);

  if (!isAbsolute(plan.projectDir)) {
    throw new TypeError(`Asset pipeline ${plan.stage} project directory must be absolute`);
  }

  const configuredProject = resolve(plan.projectDir);
  const configuredOutput = isAbsolute(plan.outputDir)
    ? resolve(plan.outputDir)
    : resolve(configuredProject, plan.outputDir);
  if (
    configuredOutput === configuredProject ||
    !isContainedAssetPath(configuredProject, configuredOutput)
  ) {
    throw new TypeError(
      `Asset pipeline ${plan.stage} output directory must be inside its project`,
    );
  }

  const [projectDir, outputDir] = await Promise.all([
    realPath(configuredProject).then(resolve),
    canonicalizePlannedAssetPath(configuredOutput),
  ]);
  const comparisonProjectDir = comparisonPath(projectDir);
  const comparisonOutputDir = comparisonPath(outputDir);
  if (
    comparisonOutputDir === comparisonProjectDir ||
    !isComparisonPathContained(comparisonProjectDir, comparisonOutputDir)
  ) {
    throw new TypeError(
      `Asset pipeline ${plan.stage} output directory must remain inside its physical project`,
    );
  }

  return {
    stage: plan.stage,
    projectDir,
    outputDir,
    comparisonProjectDir,
    comparisonOutputDir,
  };
}

/**
 * Reject output trees that overlap after resolving filesystem aliases.
 *
 * This must run before provider initialization: two otherwise independent
 * stages cannot safely provide transactional publication when their physical
 * destinations are the same tree or ancestor/descendant trees.
 */
export async function assertIndependentAssetStageOutputs(
  plans: readonly AssetStageOutputPlan[],
): Promise<void> {
  if (!Array.isArray(plans)) {
    throw new TypeError("Asset stage output plans must be an array");
  }
  const canonical = await Promise.all(plans.map(canonicalizePlan));

  for (const [index, first] of canonical.entries()) {
    for (const second of canonical.slice(index + 1)) {
      if (
        isComparisonPathContained(first.comparisonOutputDir, second.comparisonOutputDir) ||
        isComparisonPathContained(second.comparisonOutputDir, first.comparisonOutputDir)
      ) {
        throw new TypeError(
          `Asset pipeline output directories for ${first.stage} and ${second.stage} must not overlap physically`,
        );
      }
    }
  }
}
