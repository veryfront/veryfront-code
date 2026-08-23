/*******************************
 * Main init command implementation
 * @module
 *******************************/

import { cliLogger as logger, isVerbose } from "#cli/utils";
import { brand, dim } from "#cli/ui";
import { createTransientSpinner } from "../../ui/progress.ts";
import { createError, toError } from "veryfront/errors";
import type { InitOptions, InitRuntime, InitTemplate } from "./types.ts";
import { cwd } from "veryfront/platform";
import { getDlxCommand, getInstallCommand, getRunCommand } from "../../utils/package-manager.ts";
import { createProject, type ProjectCreationObserver } from "../../shared/project-creation.ts";
import { validateProjectName } from "../../shared/project-name.ts";
import { promptForEnvVars } from "../../utils/env-prompt.ts";
import { runInteractiveWizard, shouldRunWizard } from "./interactive-wizard.ts";
import { DEFAULT_TEMPLATE } from "./catalog.ts";

type StructureNode = {
  file: boolean;
  children: Map<string, StructureNode>;
};

interface InitCommandDependencies {
  deployProject?: (projectDir: string) => Promise<string>;
}

const STRUCTURE_ORDER = [
  "app",
  "pages",
  "agents",
  "tools",
  "workflows",
  "tasks",
  "prompts",
  "resources",
  "skills",
  "components",
  "lib",
  "content",
  "AGENTS.md",
  "README.md",
  "package.json",
  "deno.json",
  "tsconfig.json",
  ".env",
  ".env.example",
  ".gitignore",
];

function structureRank(name: string): number {
  const index = STRUCTURE_ORDER.indexOf(name);
  return index === -1 ? STRUCTURE_ORDER.length : index;
}

function sortStructureEntries([nameA, nodeA]: [string, StructureNode], [nameB, nodeB]: [
  string,
  StructureNode,
]): number {
  const rankDiff = structureRank(nameA) - structureRank(nameB);
  if (rankDiff !== 0) return rankDiff;

  if (nodeA.file !== nodeB.file) return nodeA.file ? 1 : -1;
  return nameA.localeCompare(nameB);
}

function renderProjectStructure(rootName: string, paths: string[], maxLines = 22): string[] {
  const root: StructureNode = { file: false, children: new Map() };
  const normalizedPaths = [...new Set(paths)]
    .filter((path) => path && !path.endsWith("/"))
    .sort();

  for (const path of normalizedPaths) {
    const parts = path.split("/").filter(Boolean);
    let current = root;

    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      let child = current.children.get(part);
      if (!child) {
        child = { file: isFile, children: new Map() };
        current.children.set(part, child);
      }
      if (isFile) child.file = true;
      current = child;
    }
  }

  const lines = [`${rootName}/`];
  let omitted = 0;

  function walk(node: StructureNode, depth: number): void {
    const entries = [...node.children.entries()].sort(sortStructureEntries);

    for (const [name, child] of entries) {
      if (lines.length >= maxLines) {
        omitted++;
        continue;
      }

      lines.push(`${"  ".repeat(depth)}${name}${child.file ? "" : "/"}`);
      if (!child.file) walk(child, depth + 1);
    }
  }

  walk(root, 1);

  if (omitted > 0) {
    lines.push(`${"  ".repeat(1)}... ${omitted} more ${omitted === 1 ? "entry" : "entries"}`);
  }

  return lines;
}

/**
 * Initializes a new Veryfront project with the specified template
 */
export async function initCommand(
  options: InitOptions,
  dependencies: InitCommandDependencies = {},
): Promise<void> {
  const { name, quiet = false } = options;
  const { integrations = [] } = options;
  const parentDir = options.parentDir ?? cwd();

  function log(msg: string): void {
    if (!quiet) logger.info(msg);
  }

  let template: InitTemplate;
  let projectName = name;
  let initGit = options.initGit ?? false;

  // Validate project name before doing anything else
  if (name) {
    const nameError = validateProjectName(name);
    if (nameError) {
      throw toError(createError({ type: "config", message: nameError }));
    }
  }

  let wizardRuntime: InitRuntime = "node";
  if (shouldRunWizard(options)) {
    const wizardResult = await runInteractiveWizard(name, options.runtime);
    if (wizardResult.cancelled) {
      return;
    }
    template = wizardResult.template;
    if (wizardResult.projectName) {
      projectName = wizardResult.projectName;
    }
    initGit = wizardResult.initGit;
    wizardRuntime = wizardResult.runtime;
  } else {
    template = options.template ?? DEFAULT_TEMPLATE;
  }

  const runtime: InitRuntime = options.runtime ?? wizardRuntime;
  // Whether the target can be written to is `createProject`'s call: it knows
  // which files the template ships, so it refuses exactly the files it would
  // overwrite rather than any directory that happens to exist.

  let installSpinner: ReturnType<typeof createTransientSpinner> | null = null;
  const installObserver: ProjectCreationObserver = {
    onEvent(event) {
      if (event.kind === "dependency-installation-started") {
        installSpinner = quiet
          ? null
          : createTransientSpinner(`Installing dependencies with ${event.packageManager}...`);
        return;
      }

      if (event.status === "installed") {
        installSpinner?.success("Dependencies installed");
        return;
      }

      installSpinner?.error("Dependency installation failed");
      if (!quiet) {
        logger.warn(
          `Run '${getInstallCommand(event.packageManager)}' manually to install dependencies.`,
        );
      }
    },
  };

  const result = await createProject(
    {
      name: projectName,
      parentDir,
      template,
      runtime,
      integrations,
      environmentValues: options.env ?? {},
      conflictPolicy: options.force ? "overwrite" : "fail",
      installDependencies: !options.skipInstall,
      initializeGit: initGit,
      includePackageMetadata: !quiet,
    },
    {
      observer: installObserver,
      resolveEnvironmentFiles: (variables, values) =>
        promptForEnvVars(variables, {
          skipPrompt: options.skipEnvPrompt,
          prefilledValues: values,
        }),
    },
  );

  if (result.gitInitialization === "failed" && !quiet) {
    logger.warn("Git initialization failed");
  }

  const createdProjectDir = result.projectDir;

  // Deploy to cloud if --deploy flag is set
  let deployedUrl: string | undefined;
  const manualDeployCommand = quiet
    ? `${getDlxCommand(result.packageManager)} veryfront deploy`
    : getRunCommand(result.packageManager, "deploy");
  if (options.deploy) {
    const manualDeployHint = `Run ${brand(manualDeployCommand)} to deploy later.`;

    if (dependencies.deployProject) {
      try {
        deployedUrl = await dependencies.deployProject(createdProjectDir);
        if (!deployedUrl) {
          throw new Error("Deploy completed without a verified result.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!quiet) console.log();
        log(`  Deploy failed: ${message}`);
        log(`  Your project was created locally. ${manualDeployHint}`);
      }
    } else {
      const { chdir } = await import("veryfront/platform");
      const { ensureAuthenticated } = await import("../../auth/index.ts");
      const { deployCommand } = await import("../deploy/index.ts");
      const authResult = await ensureAuthenticated(undefined, createdProjectDir);

      if (!authResult) {
        if (!quiet) console.log();
        log(`  Authentication required for --deploy. ${manualDeployHint}`);
      } else {
        if (!quiet) console.log();
        log(`  Deploying project...`);

        try {
          chdir(createdProjectDir);

          const deployment = await deployCommand({
            projectDir: createdProjectDir,
            branch: "main",
            env: "production",
            force: true,
            dryRun: false,
            quiet: true,
          });

          if (!deployment) {
            throw new Error("Deploy completed without a verified result.");
          }
          deployedUrl = deployment.url;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!quiet) console.log();
          log(`  Deploy failed: ${message}`);
          log(`  Your project was created locally. ${manualDeployHint}`);
        }
      }
    }
  }

  // Build success box with next steps
  const pm = result.packageManager;
  const devCommand = getRunCommand(pm, "dev");

  const localSteps: string[] = [];
  if (projectName) {
    localSteps.push(`cd ${projectName}`);
  }
  if (options.skipInstall) {
    localSteps.push(getInstallCommand(pm));
  }
  localSteps.push(devCommand);

  const displayName = projectName ?? "Project";
  const structureRoot = projectName ?? ".";
  const structureLines = renderProjectStructure(structureRoot, result.createdPaths);
  const deployCommandHint = getRunCommand(pm, "deploy");

  if (!quiet) {
    console.log();
    console.log(`  ✓ ${displayName} ready`);

    if (isVerbose()) {
      console.log();
      console.log("  Project structure");
      for (const line of structureLines) {
        console.log(`  ${line}`);
      }
    }

    console.log();
    for (const [index, step] of localSteps.entries()) {
      console.log(`  ${index === 0 ? brand(step) : step}`);
    }

    if (deployedUrl) {
      console.log();
      console.log(`  Live: ${brand(deployedUrl)}`);
    } else {
      console.log();
      console.log(`  Deploy: ${brand(deployCommandHint)}`);
    }

    const tips: string[] = [];
    if (result.setupTips.length) {
      for (const tip of result.setupTips) {
        tips.push(dim(tip));
      }
    }

    if (tips.length) {
      console.log();
      for (const tip of tips) {
        console.log(`  ${tip}`);
      }
    }

    console.log();
  }
}
