export interface ParseOptions {
    alias?: Record<string, string | string[]>;
    boolean?: string | string[];
    default?: Record<string, unknown>;
    stopEarly?: boolean;
    string?: string | string[];
    collect?: string | string[];
    negatable?: string | string[];
    unknown?: (arg: string) => boolean;
}
export interface Args {
    _: string[];
    [key: string]: unknown;
}
export declare function parse(args: string[], options?: ParseOptions): Args;
//# sourceMappingURL=flags.d.ts.map