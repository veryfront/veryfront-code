import type { InitTemplate } from "./init/types.js";
import type { IntegrationName } from "../templates/types.js";
export interface NewTuiResult {
    template: InitTemplate;
    integrations: IntegrationName[];
    cancelled: boolean;
}
export declare function runNewTui(projectName: string, _userEmail?: string): Promise<NewTuiResult>;
//# sourceMappingURL=new-tui.d.ts.map