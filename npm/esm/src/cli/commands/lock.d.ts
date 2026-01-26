interface LockOptions {
    projectDir: string;
    update?: boolean;
    verify?: boolean;
    clear?: boolean;
    list?: boolean;
    force?: boolean;
}
export declare function lockCommand(options: LockOptions): Promise<void>;
export {};
//# sourceMappingURL=lock.d.ts.map