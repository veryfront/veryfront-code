import type { VeryfrontConfig } from "../../config/types.js";
export interface ValidationResult {
    valid: boolean;
    warnings: string[];
    errors: string[];
}
export declare function validateAIConfig(config: VeryfrontConfig): ValidationResult;
export declare function runAIConfigValidation(config: VeryfrontConfig): void;
//# sourceMappingURL=config-validator.d.ts.map