import { cyan, dim, green } from "#cli/ui";
import { isCiEnv, isDenoTestingEnv } from "veryfront/config";
import { isInteractive as checkIsInteractive } from "veryfront/platform";
import { cliLogger as logger } from "#cli/utils";
import { multiSelect, select } from "../../utils/terminal-select.ts";
import {
  getIntegrationSelectOptionsWithHeaders,
  getTemplateSelectOptions,
  TEMPLATES,
} from "./catalog.ts";
import type { IntegrationName } from "../../templates/types.ts";
import type { InitTemplate } from "./types.ts";

export interface WizardResult {
  template: InitTemplate;
  integrations: IntegrationName[];
  skipped: boolean;
}

function canRunWizard(): boolean {
  return !(isCiEnv() || isDenoTestingEnv()) && checkIsInteractive();
}

export async function runInteractiveWizard(): Promise<WizardResult> {
  if (!canRunWizard()) {
    return { template: "minimal", integrations: [], skipped: true };
  }

  console.log("");
  console.log(green("Welcome to Veryfront!"));
  console.log("Let's set up your project.");

  const templateChoice = await select(
    "What would you like to build?",
    getTemplateSelectOptions(),
    0,
  );
  const template = templateChoice as InitTemplate | undefined;

  if (!template) {
    logger.warn("No template selected, using minimal");
    return { template: "minimal", integrations: [], skipped: false };
  }

  if (template !== "chat") {
    const templateLabel = TEMPLATES.find((t) => t.id === template)?.label ?? template;
    console.log("");
    console.log(green("Got it!") + ` Creating a ${templateLabel} project.`);
    return { template, integrations: [], skipped: false };
  }

  console.log("");
  console.log(dim("Use arrow keys to navigate, space to select, enter to confirm"));
  console.log(dim("Popular choices: Gmail, Slack, GitHub, Calendar, Notion"));
  console.log("");

  const integrationOptions = getIntegrationSelectOptionsWithHeaders().filter((c) => !c.isHeader);
  const selected = await multiSelect(
    "Which services should your agent connect to?",
    integrationOptions,
  );
  const integrations = selected as IntegrationName[];

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

  return { template: "chat", integrations, skipped: false };
}

export function shouldRunWizard(options: { template?: string; integrations?: string[] }): boolean {
  return !options.template && (options.integrations?.length ?? 0) === 0;
}
