type AuthMethod = "google" | "github" | "microsoft" | "token";
export interface DemoOptions {
    /** Project name for the demo (default: demo-{random}) */
    projectName?: string;
    /** Auto-advance through steps after 3 seconds */
    auto?: boolean;
    /** Pre-selected login method for auto mode */
    loginMethod?: AuthMethod;
}
export declare function demoCommand(options?: DemoOptions): Promise<void>;
export {};
//# sourceMappingURL=demo.d.ts.map