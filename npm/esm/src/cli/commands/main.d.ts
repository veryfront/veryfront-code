/**************************
 * Main Menu - Interactive CLI launcher
 **************************/
export type MenuAction = "new" | "dev" | "deploy" | "login" | "help" | "exit";
/**
 * Prompt for project name with inline text input
 * Shows a random default name that can be accepted by pressing Enter
 */
export declare function promptProjectName(): Promise<string | null>;
export declare function showMainMenu(): Promise<MenuAction | null>;
//# sourceMappingURL=main.d.ts.map