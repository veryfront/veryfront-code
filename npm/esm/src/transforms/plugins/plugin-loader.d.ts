import type { Root as HastRoot } from "@types/hast";
import type { Root as MdastRoot } from "@types/mdast";
import type { Pluggable } from "unified";
export type PluginFunction = (tree: MdastRoot | HastRoot, file?: unknown) => void | Promise<void> | ((tree: MdastRoot | HastRoot, file?: unknown) => void);
export declare function getRemarkPlugins(): Pluggable[];
export declare function getRehypePlugins(): Pluggable[];
//# sourceMappingURL=plugin-loader.d.ts.map