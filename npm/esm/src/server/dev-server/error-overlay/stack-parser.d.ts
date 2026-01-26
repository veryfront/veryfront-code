export interface ParsedStackFrame {
    raw: string;
    file?: string;
    line?: number;
    column?: number;
    function?: string;
}
export declare function parseStackTrace(stack: string): ParsedStackFrame[];
export declare function formatStackTrace(stack: string): string;
export declare function hasStackTrace(error: Error): boolean;
//# sourceMappingURL=stack-parser.d.ts.map