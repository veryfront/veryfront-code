/**
 * Interactive CLI wizard for project initialization
 * Guides users through template and integration selection with arrow key navigation
 */

import { cyan, dim, green } from "@veryfront/compat/console";
import { cliLogger as logger } from "@veryfront/utils";
import { getEnv, isInteractive as checkIsInteractive } from "../../../platform/compat/process.ts";
import { multiSelect, select } from "../../utils/terminal-select.ts";
import type { IntegrationName } from "../../templates/types.ts";
import type { InitTemplate } from "./types.ts";

export interface WizardResult {
  template: InitTemplate;
  integrations: IntegrationName[];
  skipped: boolean;
}

const TEMPLATES = [
  { value: "ai", label: "AI Agent", description: "AI-powered agent with service integrations" },
  { value: "app", label: "Full App", description: "Complete app with auth and dashboard" },
  { value: "blog", label: "Blog", description: "Blog with MDX posts" },
  { value: "docs", label: "Docs", description: "Documentation site" },
  { value: "minimal", label: "Minimal", description: "Simple starting point" },
];

const INTEGRATIONS = [
  { value: "gmail", label: "Gmail", description: "Read and send emails" },
  { value: "slack", label: "Slack", description: "Team messaging" },
  { value: "github", label: "GitHub", description: "Repos and PRs" },
  { value: "calendar", label: "Calendar", description: "Google Calendar" },
];

/**
 * Check if we're in an interactive terminal
 */
function canRunWizard(): boolean {
  const disablePrompt = getEnv("CI") === "1" || getEnv("DENO_TESTING") === "1";
  return !disablePrompt && checkIsInteractive();
}

/**
 * Run the interactive wizard
 */
export async function runInteractiveWizard(): Promise<WizardResult> {
  if (!canRunWizard()) {
    return {
      template: "minimal",
      integrations: [],
      skipped: true,
    };
  }

  console.log("");
  console.log(green("Welcome to Veryfront!"));
  console.log("Let's set up your project.");

  // Step 1: Select template type
  const templateChoice = await select(
    "What would you like to build?",
    TEMPLATES,
    0, // Default to AI Agent
  );

  if (!templateChoice) {
    logger.warn("No template selected, using minimal");
    return {
      template: "minimal",
      integrations: [],
      skipped: false,
    };
  }

  const template = templateChoice as InitTemplate;

  // If not AI template, we're done
  if (template !== "ai") {
    const templateLabel = TEMPLATES.find((t) => t.value === template)?.label || template;
    console.log("");
    console.log(green("Got it!") + ` Creating a ${templateLabel} project.`);
    return {
      template,
      integrations: [],
      skipped: false,
    };
  }

  // Step 2: For AI template, select integrations
  const selected = await multiSelect(
    "Which services should your agent connect to?",
    INTEGRATIONS,
  );
  const integrations = selected as IntegrationName[];

  // Summary
  console.log("");
  console.log(green("Perfect!") + " Here's what we'll create:");
  console.log("");
  console.log(`  ${cyan("Template:")} AI Agent`);
  if (integrations.length > 0) {
    console.log(`  ${cyan("Integrations:")} ${integrations.join(", ")}`);
  } else {
    console.log(dim("  No integrations selected (you can add them later)"));
  }
  console.log("");

  return {
    template: "ai",
    integrations,
    skipped: false,
  };
}

/**
 * Check if wizard should run (no template specified)
 */
export function shouldRunWizard(options: { template?: string; integrations?: string[] }): boolean {
  // Run wizard if no template or integrations specified
  return !options.template && (!options.integrations || options.integrations.length === 0);
}
