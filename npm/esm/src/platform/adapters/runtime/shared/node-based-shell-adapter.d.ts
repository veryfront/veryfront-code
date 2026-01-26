import type { ShellAdapter } from "../../base.js";
export declare class NodeBasedShellAdapter implements ShellAdapter {
    statSync(path: string): {
        isFile: boolean;
        isDirectory: boolean;
    };
    readFileSync(path: string): string;
}
//# sourceMappingURL=node-based-shell-adapter.d.ts.map