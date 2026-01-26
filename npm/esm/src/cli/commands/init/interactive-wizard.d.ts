import type { IntegrationName } from "../../templates/types.js";
import type { InitTemplate } from "./types.js";
export interface WizardResult {
    template: InitTemplate;
    integrations: IntegrationName[];
    skipped: boolean;
}
export declare function runInteractiveWizard(): Promise<WizardResult>;
export declare function shouldRunWizard(options: {
    template?: string;
    integrations?: string[];
}): boolean;
//# sourceMappingURL=interactive-wizard.d.ts.map