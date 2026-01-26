/**
 * RSC handler registry for managing per-project handlers
 * @module rsc-endpoints/handler-registry
 */
import { RSCDevServerHandler } from "../handlers/index.js";
export declare function getRSCHandler(projectDir: string): RSCDevServerHandler;
export declare function __resetRSCHandlerForTests(): void;
export declare function __destroyRSCHandlerForTests(): void;
//# sourceMappingURL=handler-registry.d.ts.map