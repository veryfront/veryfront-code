import type { Root } from "@types/mdast";
import type { VFile } from "vfile";
/**
 * Removes unnecessary <p> elements from MDX content.
 *
 * Handles edge cases where <p> elements get incorrectly nested inside JSX components:
 * - `<Button><p>text</p></Button>` → `<Button>text</Button>`
 * - Inline parents: `<span><p>text</p></span>` → `<span>text</span>`
 * - Multiple children with mixed content
 */
export declare function remarkMdxRemoveParagraphs(): (tree: Root) => void;
export declare function remarkCodeBlocks(): (tree: Root) => void;
export declare function remarkMdxImports(): (tree: Root, file: VFile) => void;
//# sourceMappingURL=remark-mdx-utils.d.ts.map