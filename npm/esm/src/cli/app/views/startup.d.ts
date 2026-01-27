/**
 * Startup View
 *
 * Shows loading progress with consistent box sizing.
 * Displays avatar, title, and step checklist.
 */
export interface StartupStep {
    label: string;
    status: "pending" | "active" | "done";
}
export interface StartupState {
    steps: StartupStep[];
    serverUrl?: string;
    mcpUrl?: string;
    ready: boolean;
    /** Animation frame counter for shimmer effect */
    frame: number;
}
/**
 * Render the startup view inside a consistent-sized box
 */
export declare function renderStartup(state: StartupState): string;
/**
 * Create initial startup state with steps
 */
export declare function createStartupState(stepLabels: string[]): StartupState;
/**
 * Increment animation frame for shimmer effect
 */
export declare function incrementFrame(state: StartupState): StartupState;
/**
 * Set a step to active
 */
export declare function setStepActive(state: StartupState, index: number): StartupState;
/**
 * Mark all steps done and set ready
 */
export declare function setStartupReady(state: StartupState, serverUrl: string, mcpUrl?: string): StartupState;
//# sourceMappingURL=startup.d.ts.map