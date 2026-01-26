import type { EntityInfo } from "../entities.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export declare function getEntityInfo(filePath: string, adapter?: RuntimeAdapter): Promise<EntityInfo | null>;
export declare function getEntityBySlug(projectDir: string, slug: string, adapter?: RuntimeAdapter): Promise<EntityInfo | null>;
export declare function getLayoutEntity(projectDir: string, layoutName: string, adapter?: RuntimeAdapter): Promise<EntityInfo | null>;
//# sourceMappingURL=getEntityInfo.d.ts.map