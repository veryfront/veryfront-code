import { formatBytes } from "../../utils/index.js";
export declare function isTTY(): boolean;
export declare function isStderrTTY(): boolean;
export declare function shouldUseColor(forceColor?: boolean): boolean;
export declare function setColorMode(enabled: boolean | undefined): void;
export declare function getColorEnabled(): boolean;
export declare function stripColors(str: string): string;
export declare function conditionalColor<T extends (s: string) => string>(colorFn: T, text: string): string;
export declare function showLogo(): void;
export declare function showHelp(): void;
export declare function showVersion(): void;
export declare function logSuccess(message: string): void;
export declare function logError(message: string): void;
export declare function logWarning(message: string): void;
export declare function logInfo(message: string): void;
export declare function registerTerminationSignals(handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>): () => void;
export declare function setVerboseMode(enabled: boolean): void;
export declare function setQuietMode(enabled: boolean): void;
export declare function isVerbose(): boolean;
export declare function isQuiet(): boolean;
export declare function logVerbose(message: string): void;
export declare function promptUser(message: string): Promise<string>;
export declare function confirmPrompt(message: string, defaultValue?: boolean): Promise<boolean>;
interface Spinner {
    start: () => void;
    stop: (finalMessage?: string) => void;
    update: (message: string) => void;
}
/**
 * Create a no-op spinner that does nothing (for quiet mode)
 */
export declare function createNoopSpinner(): Spinner;
export declare function createSpinner(message: string): Spinner;
export declare function exitProcess(code: number): void;
export { formatBytes };
//# sourceMappingURL=index.d.ts.map