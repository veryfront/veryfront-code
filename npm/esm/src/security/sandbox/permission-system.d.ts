export type Permission = "net" | "fs" | "env" | "run" | "read" | "write";
export interface PermissionRequest {
    name: Permission;
    host?: string;
    path?: string;
}
export interface PermissionResult {
    state: "granted" | "denied" | "prompt";
}
export declare function requestPermission(request: PermissionRequest): Promise<PermissionResult>;
//# sourceMappingURL=permission-system.d.ts.map