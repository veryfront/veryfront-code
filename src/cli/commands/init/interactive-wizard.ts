/**
 * Interactive CLI wizard for project initialization
 * Guides users through template and integration selection
 */

import { cyan, dim, green } from "@veryfront/compat/console";
import { cliLogger as logger } from "@veryfront/utils";
import {
  getEnv,
  isInteractive as checkIsInteractive,
  promptSync,
} from "../../../platform/compat/process.ts";
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
 * Display a selection menu and get user choice
 */
function selectOne(
  question: string,
  options: Array<{ value: string; label: string; description?: string }>,
  defaultValue?: string,
): string | null {
  console.log("");
  console.log(cyan("?") + " " + question);
  console.log("");

  options.forEach((opt, i) => {
    const num = `  ${i + 1})`;
    const desc = opt.description ? dim(` - ${opt.description}`) : "";
    console.log(`${num} ${opt.label}${desc}`);
  });

  console.log("");
  const defaultHint = defaultValue
    ? ` (default: ${options.find((o) => o.value === defaultValue)?.label || defaultValue})`
    : "";

  const answer = promptSync(`Enter number [1-${options.length}]${defaultHint}:`);

  if (!answer && defaultValue) {
    return defaultValue;
  }

  const num = parseInt(answer || "", 10);
  if (num >= 1 && num <= options.length) {
    const opt = options[num - 1];
    if (opt) return opt.value;
  }

  // Try matching by value or label
  const match = options.find(
    (o) =>
      o.value.toLowerCase() === answer?.toLowerCase() ||
      o.label.toLowerCase() === answer?.toLowerCase(),
  );

  return match?.value || null;
}

/**
 * Display a multi-select menu and get user choices
 */
function selectMany(
  question: string,
  options: Array<{ value: string; label: string; description?: string }>,
  preselected: string[] = [],
): string[] {
  console.log("");
  console.log(cyan("?") + " " + question);
  console.log(dim("  Enter numbers separated by commas, or 'all' for all options"));
  console.log("");

  options.forEach((opt, i) => {
    const num = `  ${i + 1})`;
    const selected = preselected.includes(opt.value) ? green(" [selected]") : "";
    const desc = opt.description ? dim(` - ${opt.description}`) : "";
    console.log(`${num} ${opt.label}${desc}${selected}`);
  });

  console.log("");
  const preselectedHint = preselected.length > 0
    ? ` (press Enter to keep: ${preselected.join(", ")})`
    : "";

  const answer = promptSync(`Enter numbers${preselectedHint}:`);

  if (!answer && preselected.length > 0) {
    return preselected;
  }

  if (answer?.toLowerCase() === "all") {
    return options.map((o) => o.value);
  }

  if (!answer) {
    return [];
  }

  const nums = answer.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10));
  const selected: string[] = [];

  for (const num of nums) {
    if (num >= 1 && num <= options.length) {
      const opt = options[num - 1];
      if (opt) selected.push(opt.value);
    }
  }

  return selected;
}

/**
 * Run the interactive wizard
 */
export function runInteractiveWizard(): WizardResult {
  if (!canRunWizard()) {
    return {
      template: "minimal",
      integrations: [],
      skipped: true,
    };
  }

  console.log("");
  console.log(green("Welcome to Veryfront!"));
  console.log("Let's set up your project.\n");

  // Step 1: Select template type
  const templateChoice = selectOne(
    "What would you like to build?",
    TEMPLATES,
    "ai",
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

  // Step 2: For AI template, select integrations directly
  const selected = selectMany(
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
