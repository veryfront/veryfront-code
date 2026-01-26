import { CONTINUE, SKIP, visit } from "unist-util-visit";
/**
 * Spacer node to preserve whitespace when unwrapping paragraphs
 */
const spacer = {
    type: "mdxFlowExpression",
    value: "' '",
    data: {
        estree: {
            type: "Program",
            body: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "Literal",
                        value: " ",
                        raw: "' '",
                    },
                },
            ],
            sourceType: "module",
        },
    },
};
// Replace node at index with multiple children nodes
// Reference: https://github.com/mdx-js/mdx/issues/1451#issuecomment-780428572
function mergeChildren(node, index, children) {
    if (!node.children)
        return;
    node.children.splice(index, 1, ...children);
}
const textNodeTypes = new Set([
    "text",
    "paragraph",
    "heading",
    "link",
    "image",
    "list",
    "listItem",
    "emphasis",
    "strong",
    "blockquote",
    "code",
    "inlineCode",
    "thematicBreak",
    "table",
    "tableRow",
    "tableCell",
    "footnote",
    "footnoteDefinition",
]);
const validParentBlockElements = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "details",
    "dialog",
    "canvas",
    "dl",
    "dt",
    "dd",
    "div",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "header",
    "hgroup",
    "main",
    "nav",
    "pre",
    "section",
    "video",
]);
function isJsxComponentName(name = "") {
    // Check if name starts with a capital letter (JSX component, not HTML element)
    return name.match(/^[A-Z]/);
}
/**
 * Removes unnecessary <p> elements from MDX content.
 *
 * Handles edge cases where <p> elements get incorrectly nested inside JSX components:
 * - `<Button><p>text</p></Button>` → `<Button>text</Button>`
 * - Inline parents: `<span><p>text</p></span>` → `<span>text</span>`
 * - Multiple children with mixed content
 */
export function remarkMdxRemoveParagraphs() {
    return (tree) => {
        // First pass: add spacers between elements when parent has non-text children
        visit(tree, ["paragraph"], (_node, _index, parent) => {
            const extParent = parent;
            const parentName = extParent?.name ?? extParent?.type ?? extParent?.tagName;
            if (parentName === "root")
                return CONTINUE;
            const hasNonTextChild = extParent?.children?.some((child) => !textNodeTypes.has(child.type));
            if (!hasNonTextChild || !extParent)
                return CONTINUE;
            const isAlreadySpaced = extParent.children.some((c) => !!c.isMdxTextSpacer);
            if (isAlreadySpaced)
                return CONTINUE;
            const children = [];
            extParent.children.forEach((child, i) => {
                if (i > 0) {
                    children.push({
                        ...spacer,
                        isMdxTextSpacer: true,
                    });
                }
                children.push(child);
            });
            extParent.children = children;
            return CONTINUE;
        });
        // Second pass: unwrap paragraphs
        visit(tree, ["paragraph"], (node, index, parent) => {
            const extParent = parent;
            const paragraphNode = node;
            const parentName = extParent?.name ?? extParent?.type ?? extParent?.tagName;
            if (!extParent)
                return CONTINUE;
            const idx = typeof index === "number" ? index : -1;
            const previousChild = idx >= 0 ? extParent.children[idx - 1] : undefined;
            // Unwrap <p> elements when they appear inside a direct <p> parent
            if (parentName === "p" && idx >= 0) {
                const child = paragraphNode.children?.[0];
                if (child)
                    extParent.children[idx] = child;
                return [SKIP, idx];
            }
            // Keep behavior consistent between children
            if (previousChild?.type === "paragraph")
                return CONTINUE;
            if (parentName === "root")
                return CONTINUE;
            const hasNonTextChild = extParent.children.some((child) => !textNodeTypes.has(child.type));
            if (hasNonTextChild && idx >= 0) {
                // Unwrap <p> elements when child contains other children besides text
                mergeChildren(extParent, idx, paragraphNode.children);
                return [SKIP, idx];
            }
            // Unwrap <p> elements with single text child elements
            // e.g. <Button><p>Do not wrap</p></Button> => <Button>Do not wrap</Button>
            if (extParent.children.length === 1) {
                extParent.children = paragraphNode.children;
                return [SKIP, idx >= 0 ? idx : 0];
            }
            const isElementParent = !isJsxComponentName(parentName);
            const isInlineParent = !validParentBlockElements.has(parentName ?? "");
            // Unwrap <p> elements which are children of inline elements
            // e.g. <span><p>Do not wrap</p></span> => <span>Do not wrap</span>
            if (isElementParent && isInlineParent && idx >= 0) {
                const child = paragraphNode.children?.[0];
                if (child)
                    extParent.children[idx] = child;
            }
            return CONTINUE;
        });
    };
}
export function remarkCodeBlocks() {
    return (tree) => {
        visit(tree, "code", (node) => {
            const codeNode = node;
            codeNode.data ??= {};
            codeNode.data.hProperties ??= {};
            if (codeNode.lang) {
                codeNode.data.hProperties.className = [`language-${codeNode.lang}`];
            }
            if (!codeNode.meta)
                return;
            const highlightMatch = codeNode.meta.match(/\{([\d,-]+)\}/);
            if (highlightMatch) {
                codeNode.data.hProperties["data-line-numbers"] = highlightMatch[1];
            }
        });
    };
}
export function remarkMdxImports() {
    return (tree, file) => {
        const imports = [];
        visit(tree, "mdxjsEsm", (node) => {
            if (!node.value?.includes("import"))
                return;
            const importMatches = node.value.matchAll(/import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g);
            for (const match of importMatches) {
                const path = match[1];
                if (typeof path === "string")
                    imports.push(path);
            }
        });
        file.data.imports = imports;
    };
}
