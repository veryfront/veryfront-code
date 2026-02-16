import { brand, dim, muted } from "#cli/ui";
import { getAgentFace } from "../../ui/dot-matrix.ts";
import { isCiEnv, isDenoTestingEnv } from "veryfront/config";
import { isInteractive as checkIsInteractive } from "veryfront/platform";
import { select, textInput } from "../../utils/terminal-select.ts";
import { getTemplateSelectOptions, TEMPLATES } from "./catalog.ts";
import type { InitTemplate } from "./types.ts";

export interface WizardResult {
  projectName: string | null; // null = use current directory
  template: InitTemplate;
  initGit: boolean;
  skipped: boolean;
  cancelled: boolean;
}

function canRunWizard(): boolean {
  return !(isCiEnv() || isDenoTestingEnv()) && checkIsInteractive();
}

export async function runInteractiveWizard(): Promise<WizardResult> {
  if (!canRunWizard()) {
    return {
      projectName: null,
      template: "minimal",
      initGit: false,
      skipped: true,
      cancelled: false,
    };
  }

  // Show logo
  console.log("");
  console.log(getAgentFace({ litColor: "\x1b[38;2;252;143;93m" }));
  console.log("");
  console.log(`┌  ${brand("Veryfront")}`);
  console.log(`│  Let's set up your project.`);
  console.log("│");

  // Step 1: Location prompt
  const locationChoice = await select(
    "Where should we create your project?",
    [
      { value: "current", label: "Current folder", description: "Use this directory" },
      { value: "new", label: "New folder", description: "Create a new directory" },
    ],
    0,
  );

  if (locationChoice === null) {
    console.log(muted("\n  Cancelled.\n"));
    return {
      projectName: null,
      template: "minimal",
      initGit: false,
      skipped: false,
      cancelled: true,
    };
  }

  let projectName: string | null = null;
  if (locationChoice === "new") {
    const name = await textInput("Project name", "my-app");
    if (name === null) {
      console.log(muted("\n  Cancelled.\n"));
      return {
        projectName: null,
        template: "minimal",
        initGit: false,
        skipped: false,
        cancelled: true,
      };
    }
    if (name) {
      projectName = name;
    }
  }

  // Step 2: Template selection
  const templateChoice = await select(
    "What would you like to build?",
    getTemplateSelectOptions(),
    0,
  );

  if (templateChoice === null) {
    console.log(muted("\n  Cancelled.\n"));
    return {
      projectName: null,
      template: "minimal",
      initGit: false,
      skipped: false,
      cancelled: true,
    };
  }

  const template = templateChoice as InitTemplate;

  // Step 3: Git init prompt
  const gitChoice = await select(
    "Initialize a git repository?",
    [
      { value: "yes", label: "Yes", description: "Initialize git and create first commit" },
      { value: "no", label: "No", description: "Skip git initialization" },
    ],
    0,
  );

  if (gitChoice === null) {
    console.log(muted("\n  Cancelled.\n"));
    return {
      projectName: null,
      template: "minimal",
      initGit: false,
      skipped: false,
      cancelled: true,
    };
  }

  const initGit = gitChoice === "yes";

  // Summary
  const templateLabel = TEMPLATES.find((t) => t.id === template)?.label ?? template;
  console.log("");
  console.log(brand("Perfect!") + " Here's what we'll create:");
  console.log("");
  if (projectName) {
    console.log(`  ${brand("Location:")} ./${projectName}/`);
  } else {
    console.log(`  ${brand("Location:")} ./  ${dim("(current folder)")}`);
  }
  console.log(`  ${brand("Template:")} ${templateLabel}`);
  console.log(`  ${brand("Git:")} ${initGit ? "Yes" : "No"}`);
  console.log("");

  return { projectName, template, initGit, skipped: false, cancelled: false };
}

export function shouldRunWizard(options: { template?: string }): boolean {
  // Always run wizard unless template is explicitly specified via --template
  return !options.template;
}
