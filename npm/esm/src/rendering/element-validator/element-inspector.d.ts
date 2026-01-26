export interface InspectionOptions {
    maxDepth: number;
    debugMode: boolean;
}
/** Recursively inspects element tree for invalid children that would cause React Error #31 */
export declare function deepInspectElement(element: unknown, path: string, depth: number, options: InspectionOptions): void;
//# sourceMappingURL=element-inspector.d.ts.map