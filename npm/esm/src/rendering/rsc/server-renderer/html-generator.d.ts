import type { RSCNode } from "../types.js";
import { escapeHtml } from "../../../html/html-escape.js";
export { escapeHtml };
export declare function renderAttributes(props: Record<string, unknown>): string;
export declare function treeToHTML(node: RSCNode): Promise<string>;
//# sourceMappingURL=html-generator.d.ts.map