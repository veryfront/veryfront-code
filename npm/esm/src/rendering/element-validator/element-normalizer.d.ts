import * as React from "react";
import { type InspectionOptions } from "./element-inspector.js";
export interface NormalizationOptions {
    inspectionEnabled?: boolean;
    debugMode?: boolean;
    inspectionOptions: InspectionOptions;
}
/** Validates and normalizes a React element before rendering */
export declare function ensureValidReactElement(pageElement: React.ReactNode, options: NormalizationOptions): React.ReactElement;
//# sourceMappingURL=element-normalizer.d.ts.map