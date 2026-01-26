import type { DenoRedisModule, NodeRedisModule } from "./types.js";
export declare function getRedisModule(): Promise<{
    DenoRedis: DenoRedisModule | null;
    NodeRedis: NodeRedisModule | null;
}>;
export declare function clearModuleCache(): void;
//# sourceMappingURL=modules.d.ts.map