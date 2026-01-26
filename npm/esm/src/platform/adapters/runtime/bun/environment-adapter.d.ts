import type { EnvironmentAdapter } from "../../base.js";
export declare class BunEnvironmentAdapter implements EnvironmentAdapter {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
}
//# sourceMappingURL=environment-adapter.d.ts.map