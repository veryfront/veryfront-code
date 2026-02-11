/**
 * TUI for new project creation
 * Uses shared catalog and terminal-select
 */

import { multiSelect, select } from "../../utils/terminal-select.ts";
import { getPopularIntegrations, getTemplateSelectOptions } from "../init/catalog.ts";
import { brand } from "#cli/ui";
import type { InitTemplate } from "../init/types.ts";
import type { IntegrationName } from "../../templates/types.ts";

export interface NewTuiResult {
  template: InitTemplate;
  integrations: IntegrationName[];
  cancelled: boolean;
}

export async function runNewTui(projectName: string, _userEmail?: string): Promise<NewTuiResult> {
  console.log();
  console.log("  Creating " + brand(projectName));
  console.log();

  const templateOptions = getTemplateSelectOptions();
  const template = await select("Template", templateOptions);

  if (!template) {
    return { template: "chat", integrations: [], cancelled: true };
  }

  console.log();

  // Use popular integrations for a simpler selection
  const integrationOptions = getPopularIntegrations().map((i) => ({
    value: i.id,
    label: i.label,
    description: i.description,
  }));

  const integrations = await multiSelect("Integrations", integrationOptions);

  if (!integrations) {
    return { template: template as InitTemplate, integrations: [], cancelled: true };
  }

  console.log();

  return {
    template: template as InitTemplate,
    integrations: integrations as IntegrationName[],
    cancelled: false,
  };
}
