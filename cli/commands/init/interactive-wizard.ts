import { muted } from "#cli/ui";
import { isCiEnv, isDenoTestingEnv } from "veryfront/config";
import { isInteractive as checkIsInteractive } from "veryfront/platform";
import { isInteractive as isCliInteractive } from "../../shared/interactive.ts";
import { select, textInput } from "../../utils/terminal-select.ts";
import { DEFAULT_TEMPLATE, getTemplateSelectOptions } from "./catalog.ts";
import type { InitRuntime, InitTemplate } from "./types.ts";

/** Reject path separators and traversal so the name stays a single directory. */
export function validateProjectName(name: string): string | null {
  if (/[/\\]/.test(name)) return 'Project name cannot contain "/" or "\\"';
  if (name === "." || name === "..") return 'Project name cannot be "." or ".."';
  return null;
}

export interface WizardResult {
  projectName: string | null; // null = use current directory
  template: InitTemplate;
  runtime: InitRuntime;
  initGit: boolean;
  skipped: boolean;
  cancelled: boolean;
}

function canRunWizard(): boolean {
  return isCliInteractive() && !(isCiEnv() || isDenoTestingEnv()) && checkIsInteractive();
}

export function formatWizardIntro(): string {
  return "\nLet's set up your project.";
}

const SETUP_PROMPT_DISPLAY = {
  showMarker: false,
  showInstructions: false,
} as const;

export async function runInteractiveWizard(
  existingName?: string,
  presetRuntime?: InitRuntime,
): Promise<WizardResult> {
  if (!canRunWizard()) {
    return {
      projectName: existingName ?? null,
      template: DEFAULT_TEMPLATE,
      runtime: presetRuntime ?? "node",
      initGit: false,
      skipped: true,
      cancelled: false,
    };
  }

  console.log(formatWizardIntro());

  let projectName: string | null = existingName ?? null;

  // Location prompt (skip when name was provided via CLI)
  if (!existingName) {
    const locationChoice = await select(
      "Where should we create your project?",
      [
        {
          value: "current",
          label: "Current folder",
          description: "Use this directory",
        },
        {
          value: "new",
          label: "New folder",
          description: "Create a new directory",
        },
      ],
      0,
      SETUP_PROMPT_DISPLAY,
    );

    if (locationChoice === null) {
      console.log(muted("\n  Cancelled.\n"));
      return {
        projectName: null,
        template: DEFAULT_TEMPLATE,
        runtime: "node",
        initGit: false,
        skipped: false,
        cancelled: true,
      };
    }

    if (locationChoice === "new") {
      const name = await textInput("Project name", "my-app", SETUP_PROMPT_DISPLAY);
      if (name === null) {
        console.log(muted("\n  Cancelled.\n"));
        return {
          projectName: null,
          template: DEFAULT_TEMPLATE,
          runtime: "node",
          initGit: false,
          skipped: false,
          cancelled: true,
        };
      }
      const validName = name || "my-app";
      const nameError = validateProjectName(validName);
      if (nameError) {
        console.log(muted(`\n  ${nameError}\n`));
        return {
          projectName: null,
          template: DEFAULT_TEMPLATE,
          runtime: "node",
          initGit: false,
          skipped: false,
          cancelled: true,
        };
      }
      projectName = validName;
    }
  }

  // Template selection
  const templateChoice = await select(
    "What would you like to build?",
    getTemplateSelectOptions(),
    0,
    SETUP_PROMPT_DISPLAY,
  );

  if (templateChoice === null) {
    console.log(muted("\n  Cancelled.\n"));
    return {
      projectName: null,
      template: DEFAULT_TEMPLATE,
      runtime: "node",
      initGit: false,
      skipped: false,
      cancelled: true,
    };
  }

  const template = templateChoice as InitTemplate;

  // Runtime selection (skipped when CLI passed --runtime explicitly)
  let runtime: InitRuntime = presetRuntime ?? "node";
  if (presetRuntime === undefined) {
    const runtimeChoice = await select(
      "What runtime should this project use?",
      [
        { value: "node", label: "Node.js", description: "Default" },
        { value: "bun", label: "Bun", description: "Fast JS runtime" },
        { value: "deno", label: "Deno", description: "Secure-by-default" },
      ],
      0,
      SETUP_PROMPT_DISPLAY,
    );

    if (runtimeChoice === null) {
      console.log(muted("\n  Cancelled.\n"));
      return {
        projectName: null,
        template: DEFAULT_TEMPLATE,
        runtime: "node",
        initGit: false,
        skipped: false,
        cancelled: true,
      };
    }

    runtime = runtimeChoice as InitRuntime;
  }

  // Git init prompt
  const gitChoice = await select(
    "Initialize a git repository?",
    [
      { value: "yes", label: "Yes", description: "Initialize git and create first commit" },
      { value: "no", label: "No", description: "Skip git initialization" },
    ],
    0,
    SETUP_PROMPT_DISPLAY,
  );

  if (gitChoice === null) {
    console.log(muted("\n  Cancelled.\n"));
    return {
      projectName: null,
      template: DEFAULT_TEMPLATE,
      runtime: "node",
      initGit: false,
      skipped: false,
      cancelled: true,
    };
  }

  const initGit = gitChoice === "yes";

  return {
    projectName,
    template,
    runtime,
    initGit,
    skipped: false,
    cancelled: false,
  };
}

export function shouldRunWizard(options: { template?: string }): boolean {
  // Always run wizard unless template is explicitly specified via --template
  return !options.template;
}
