// deno-lint-ignore-file no-explicit-any
/**
 * Yoga-Lite Layout Engine
 *
 * Minimal flexbox-like layout engine for terminal UIs.
 * Inspired by Yoga (https://yogalayout.dev/) but simplified for 2D terminal grids.
 */

import { stringWidth } from "../../utils/unicode.ts";

// ============================================================================
// Types
// ============================================================================

export type FlexDirection = "row" | "column";
export type AlignItems = "start" | "center" | "end" | "stretch";
export type JustifyContent =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";
export type Display = "flex" | "none";

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutStyle {
  /** Width in characters, or 'auto' for content-based, or percentage string */
  width?: number | "auto" | `${number}%`;
  /** Height in lines, or 'auto' for content-based */
  height?: number | "auto" | `${number}%`;
  /** Minimum width */
  minWidth?: number;
  /** Maximum width */
  maxWidth?: number;
  /** Minimum height */
  minHeight?: number;
  /** Maximum height */
  maxHeight?: number;
  /** Flex direction */
  flexDirection?: FlexDirection;
  /** Flex grow factor */
  flexGrow?: number;
  /** Flex shrink factor */
  flexShrink?: number;
  /** Flex basis (initial size) */
  flexBasis?: number | "auto";
  /** Alignment of children on cross axis */
  alignItems?: AlignItems;
  /** Alignment of self on cross axis */
  alignSelf?: AlignItems;
  /** Distribution of children on main axis */
  justifyContent?: JustifyContent;
  /** Padding inside the box */
  padding?: Padding | number;
  /** Margin outside the box */
  margin?: Margin | number;
  /** Display type */
  display?: Display;
  /** Whether to wrap children */
  flexWrap?: "nowrap" | "wrap";
  /** Gap between children */
  gap?: number;
}

export interface LayoutNode {
  /** Unique identifier for the node */
  id?: string;
  /** Layout style properties */
  style: LayoutStyle;
  /** Child nodes */
  children: LayoutNode[];
  /** Content to measure (for auto-sizing) */
  content?: string;
  /** Computed layout result */
  layout?: ComputedLayout;
}

export interface ComputedLayout {
  /** X position relative to parent */
  x: number;
  /** Y position relative to parent */
  y: number;
  /** Computed width */
  width: number;
  /** Computed height */
  height: number;
  /** Content box X (after padding) */
  contentX: number;
  /** Content box Y (after padding) */
  contentY: number;
  /** Content box width */
  contentWidth: number;
  /** Content box height */
  contentHeight: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function normalizePadding(padding?: Padding | number): Padding {
  if (padding === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
}

function normalizeMargin(margin?: Margin | number): Margin {
  if (margin === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof margin === "number") {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  return margin;
}

function parseSize(
  size: number | "auto" | `${number}%` | undefined,
  containerSize: number,
): number | "auto" {
  if (size === undefined || size === "auto") {
    return "auto";
  }
  if (typeof size === "number") {
    return size;
  }
  // Percentage
  const percent = parseFloat(size);
  return Math.floor((percent / 100) * containerSize);
}

function measureContent(content?: string): { width: number; height: number } {
  if (!content) {
    return { width: 0, height: 0 };
  }

  const lines = content.split("\n");
  const height = lines.length;
  let width = 0;

  for (const line of lines) {
    const lineWidth = stringWidth(line);
    if (lineWidth > width) {
      width = lineWidth;
    }
  }

  return { width, height };
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

// ============================================================================
// Layout Algorithm
// ============================================================================

/**
 * Compute layout for a node tree
 */
export function computeLayout(
  node: LayoutNode,
  containerWidth: number,
  containerHeight: number,
): ComputedLayout {
  // Recursively compute layout
  const layout = layoutNode(node, containerWidth, containerHeight, 0, 0);
  node.layout = layout;
  return layout;
}

function layoutNode(
  node: LayoutNode,
  availableWidth: number,
  availableHeight: number,
  offsetX: number,
  offsetY: number,
): ComputedLayout {
  const style = node.style;
  const padding = normalizePadding(style.padding);
  const margin = normalizeMargin(style.margin);

  // Handle display: none
  if (style.display === "none") {
    const layout: ComputedLayout = {
      x: offsetX,
      y: offsetY,
      width: 0,
      height: 0,
      contentX: offsetX,
      contentY: offsetY,
      contentWidth: 0,
      contentHeight: 0,
    };
    node.layout = layout;
    return layout;
  }

  // Calculate available space after margins
  const marginWidth = margin.left + margin.right;
  const marginHeight = margin.top + margin.bottom;
  const availableInnerWidth = availableWidth - marginWidth;
  const availableInnerHeight = availableHeight - marginHeight;

  // Parse explicit sizes
  let width = parseSize(style.width, availableInnerWidth);
  let height = parseSize(style.height, availableInnerHeight);

  // Calculate content dimensions
  const paddingWidth = padding.left + padding.right;
  const paddingHeight = padding.top + padding.bottom;

  // Measure content if auto-sizing
  if (width === "auto" || height === "auto") {
    const contentSize = measureContent(node.content);

    if (width === "auto") {
      width = contentSize.width + paddingWidth;
    }
    if (height === "auto") {
      height = contentSize.height + paddingHeight;
    }
  }

  // Apply min/max constraints
  width = clamp(width as number, style.minWidth, style.maxWidth);
  height = clamp(height as number, style.minHeight, style.maxHeight);

  // Calculate content box
  const contentWidth = Math.max(0, (width as number) - paddingWidth);
  const contentHeight = Math.max(0, (height as number) - paddingHeight);

  // Layout children if any
  const visibleChildren = node.children.filter((c) => c.style.display !== "none");

  if (visibleChildren.length > 0) {
    const direction = style.flexDirection ?? "column";
    const alignItems = style.alignItems ?? "start";
    const justifyContent = style.justifyContent ?? "start";
    const gap = style.gap ?? 0;

    // First pass: measure children and calculate flex totals
    const childLayouts: ComputedLayout[] = [];
    let totalFlexGrow = 0;
    let totalFixedSize = 0;

    for (const child of visibleChildren) {
      const childStyle = child.style;
      const childMargin = normalizeMargin(childStyle.margin);

      // Get base size
      let childSize: number;
      if (childStyle.flexBasis !== undefined && childStyle.flexBasis !== "auto") {
        childSize = childStyle.flexBasis;
      } else {
        const childContentSize = measureContent(child.content);
        childSize = direction === "row"
          ? childContentSize.width + normalizePadding(childStyle.padding).left +
            normalizePadding(childStyle.padding).right
          : childContentSize.height + normalizePadding(childStyle.padding).top +
            normalizePadding(childStyle.padding).bottom;
      }

      const marginSize = direction === "row"
        ? childMargin.left + childMargin.right
        : childMargin.top + childMargin.bottom;

      if (childStyle.flexGrow && childStyle.flexGrow > 0) {
        totalFlexGrow += childStyle.flexGrow;
      } else {
        totalFixedSize += childSize + marginSize;
      }
    }

    // Add gaps to fixed size
    totalFixedSize += gap * (visibleChildren.length - 1);

    // Calculate available space for flex items
    const mainAxisSize = direction === "row" ? contentWidth : contentHeight;
    const remainingSpace = Math.max(0, mainAxisSize - totalFixedSize);

    // Second pass: layout children
    let mainOffset = 0;

    // Calculate starting offset based on justifyContent
    const extraSpace = remainingSpace - (totalFlexGrow > 0 ? remainingSpace : 0);
    switch (justifyContent) {
      case "center":
        mainOffset = extraSpace / 2;
        break;
      case "end":
        mainOffset = extraSpace;
        break;
      case "space-between":
        // Distribute extra space between items
        break;
      case "space-around":
        mainOffset = extraSpace / (visibleChildren.length * 2);
        break;
      case "space-evenly":
        mainOffset = extraSpace / (visibleChildren.length + 1);
        break;
    }

    const spaceBetween = justifyContent === "space-between" && visibleChildren.length > 1
      ? extraSpace / (visibleChildren.length - 1)
      : 0;

    const spaceAround = justifyContent === "space-around" ? extraSpace / visibleChildren.length : 0;

    const spaceEvenly = justifyContent === "space-evenly"
      ? extraSpace / (visibleChildren.length + 1)
      : 0;

    for (let i = 0; i < visibleChildren.length; i++) {
      const child = visibleChildren[i];
      const childStyle = child.style;
      const childMargin = normalizeMargin(childStyle.margin);
      const childPadding = normalizePadding(childStyle.padding);

      // Calculate child size
      let childWidth: number;
      let childHeight: number;

      if (direction === "row") {
        // Row layout
        if (childStyle.flexGrow && childStyle.flexGrow > 0 && totalFlexGrow > 0) {
          childWidth = (childStyle.flexGrow / totalFlexGrow) * remainingSpace;
        } else if (childStyle.width !== undefined && childStyle.width !== "auto") {
          childWidth = parseSize(childStyle.width, contentWidth) as number;
        } else {
          const childContentSize = measureContent(child.content);
          childWidth = childContentSize.width + childPadding.left + childPadding.right;
        }

        // Cross axis sizing
        const childAlignSelf = childStyle.alignSelf ?? alignItems;
        if (childAlignSelf === "stretch") {
          childHeight = contentHeight - childMargin.top - childMargin.bottom;
        } else if (childStyle.height !== undefined && childStyle.height !== "auto") {
          childHeight = parseSize(childStyle.height, contentHeight) as number;
        } else {
          const childContentSize = measureContent(child.content);
          childHeight = childContentSize.height + childPadding.top + childPadding.bottom;
        }
      } else {
        // Column layout
        if (childStyle.flexGrow && childStyle.flexGrow > 0 && totalFlexGrow > 0) {
          childHeight = (childStyle.flexGrow / totalFlexGrow) * remainingSpace;
        } else if (childStyle.height !== undefined && childStyle.height !== "auto") {
          childHeight = parseSize(childStyle.height, contentHeight) as number;
        } else {
          const childContentSize = measureContent(child.content);
          childHeight = childContentSize.height + childPadding.top + childPadding.bottom;
        }

        // Cross axis sizing
        const childAlignSelf = childStyle.alignSelf ?? alignItems;
        if (childAlignSelf === "stretch") {
          childWidth = contentWidth - childMargin.left - childMargin.right;
        } else if (childStyle.width !== undefined && childStyle.width !== "auto") {
          childWidth = parseSize(childStyle.width, contentWidth) as number;
        } else {
          const childContentSize = measureContent(child.content);
          childWidth = childContentSize.width + childPadding.left + childPadding.right;
        }
      }

      // Apply constraints
      childWidth = clamp(childWidth, childStyle.minWidth, childStyle.maxWidth);
      childHeight = clamp(childHeight, childStyle.minHeight, childStyle.maxHeight);

      // Calculate cross axis offset
      let crossOffset = 0;
      const childAlignSelf = childStyle.alignSelf ?? alignItems;
      const crossAxisSize = direction === "row" ? contentHeight : contentWidth;
      const childCrossSize = direction === "row" ? childHeight : childWidth;
      const childCrossMargin = direction === "row"
        ? childMargin.top + childMargin.bottom
        : childMargin.left + childMargin.right;

      switch (childAlignSelf) {
        case "center":
          crossOffset = (crossAxisSize - childCrossSize - childCrossMargin) / 2;
          break;
        case "end":
          crossOffset = crossAxisSize - childCrossSize - childCrossMargin;
          break;
        case "stretch":
        case "start":
        default:
          crossOffset = 0;
      }

      // Calculate position
      let childX: number;
      let childY: number;

      if (direction === "row") {
        childX = offsetX + margin.left + padding.left + mainOffset + childMargin.left;
        childY = offsetY + margin.top + padding.top + crossOffset + childMargin.top;
        mainOffset += childWidth + childMargin.left + childMargin.right + gap + spaceBetween +
          spaceAround;
        if (spaceEvenly && i < visibleChildren.length - 1) {
          mainOffset += spaceEvenly;
        }
      } else {
        childX = offsetX + margin.left + padding.left + crossOffset + childMargin.left;
        childY = offsetY + margin.top + padding.top + mainOffset + childMargin.top;
        mainOffset += childHeight + childMargin.top + childMargin.bottom + gap + spaceBetween +
          spaceAround;
        if (spaceEvenly && i < visibleChildren.length - 1) {
          mainOffset += spaceEvenly;
        }
      }

      // Recursively layout child
      const childLayout = layoutNode(
        child,
        childWidth,
        childHeight,
        childX,
        childY,
      );
      child.layout = childLayout;
      childLayouts.push(childLayout);
    }

    // If auto height/width, adjust to fit children
    if (style.height === "auto" || style.height === undefined) {
      if (direction === "column") {
        const lastChild = childLayouts[childLayouts.length - 1];
        if (lastChild) {
          height = lastChild.y + lastChild.height - offsetY - margin.top + padding.bottom +
            margin.bottom;
        }
      } else {
        let maxHeight = 0;
        for (const childLayout of childLayouts) {
          const childBottom = childLayout.y + childLayout.height - offsetY - margin.top -
            padding.top;
          if (childBottom > maxHeight) maxHeight = childBottom;
        }
        height = maxHeight + paddingHeight;
      }
    }

    if (style.width === "auto" || style.width === undefined) {
      if (direction === "row") {
        const lastChild = childLayouts[childLayouts.length - 1];
        if (lastChild) {
          width = lastChild.x + lastChild.width - offsetX - margin.left + padding.right +
            margin.right;
        }
      } else {
        let maxWidth = 0;
        for (const childLayout of childLayouts) {
          const childRight = childLayout.x + childLayout.width - offsetX - margin.left -
            padding.left;
          if (childRight > maxWidth) maxWidth = childRight;
        }
        width = maxWidth + paddingWidth;
      }
    }
  }

  const layout: ComputedLayout = {
    x: offsetX + margin.left,
    y: offsetY + margin.top,
    width: width as number,
    height: height as number,
    contentX: offsetX + margin.left + padding.left,
    contentY: offsetY + margin.top + padding.top,
    contentWidth: Math.max(0, (width as number) - paddingWidth),
    contentHeight: Math.max(0, (height as number) - paddingHeight),
  };

  node.layout = layout;
  return layout;
}

// ============================================================================
// Layout Builder (Fluent API)
// ============================================================================

export function box(style: Partial<LayoutStyle> = {}): LayoutNode {
  return {
    style: {
      flexDirection: "column",
      alignItems: "start",
      justifyContent: "start",
      ...style,
    },
    children: [],
  };
}

export function row(style: Partial<LayoutStyle> = {}): LayoutNode {
  return box({ flexDirection: "row", ...style });
}

export function column(style: Partial<LayoutStyle> = {}): LayoutNode {
  return box({ flexDirection: "column", ...style });
}

export function text(content: string, style: Partial<LayoutStyle> = {}): LayoutNode {
  return {
    style: { width: "auto", height: "auto", ...style },
    children: [],
    content,
  };
}

export function spacer(grow = 1): LayoutNode {
  return box({ flexGrow: grow });
}

export function withChildren(node: LayoutNode, children: LayoutNode[]): LayoutNode {
  return { ...node, children };
}
