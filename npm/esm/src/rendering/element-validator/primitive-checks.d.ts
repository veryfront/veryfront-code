import * as React from "react";
export declare function isValidPrimitive(value: unknown): boolean;
export declare function hasReactSymbol(obj: Record<string, unknown>): boolean;
export declare function isReactElement(value: unknown): boolean;
export declare function looksLikeReactElement(value: unknown): boolean;
export declare function getElementTypeName(element: React.ReactElement): string;
export declare function getObjectKeys(obj: unknown): string[];
export declare function getObjectSample(obj: unknown): string;
export declare function getElementDebugInfo(child: unknown): {
    type: string;
    hasSymbol: boolean;
    symbolValue?: symbol;
    typeValue?: unknown;
};
//# sourceMappingURL=primitive-checks.d.ts.map