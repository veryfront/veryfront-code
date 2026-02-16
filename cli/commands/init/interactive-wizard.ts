import { brand, dim, muted } from "#cli/ui";
import { getAgentFace } from "../../ui/dot-matrix.ts";
import { isCiEnv, isDenoTestingEnv } from "veryfront/config";
import { isInteractive as checkIsInteractive } from "veryfront/platform";
import { select } from "../../utils/terminal-select.ts";
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

export async function runInteractiveWizard(existingName?: string): Promise<WizardResult> {
  if (!canRunWizard()) {
    return {
      projectName: existingName ?? null,
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

  const projectName: string | null = existingName ?? null;

  // Template selection
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

  // Git init prompt
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
