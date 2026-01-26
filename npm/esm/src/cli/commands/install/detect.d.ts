/**
 * AI Tool Detection - Detects which AI coding tools are in use
 */
import { type AIToolId, type DetectOptions } from "./types.js";
import { type RuntimeEnv } from "../../../config/runtime-env.js";
export declare function detectAITools(options?: DetectOptions, env?: RuntimeEnv): Promise<AIToolId[]>;
export declare function formatDetectionHint(detected: AIToolId[]): string;
//# sourceMappingURL=detect.d.ts.map