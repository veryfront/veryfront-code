/**
 * Tag — ported 1:1 from Veryfront Studio. A small rounded chip for metadata /
 * labels, with link and button affordances plus a wrapping group. Semantic
 * classes remapped to veryfront's `[var(--token)]` vocabulary. Private to the
 * chat module.
 *
 * @example
 * ```tsx
 * import { Tag, TagGroup, TagLink } from "veryfront/ui";
 *
 * <TagGroup>
 *   <Tag>TypeScript</Tag>
 *   <TagLink href="https://veryfront.com">Docs</TagLink>
 * </TagGroup>;
 * ```
 *
 * @module react/components/ui/tag
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";

const tagClasses =
  "inline-flex items-center rounded-full bg-[var(--edge)] px-3 py-1 text-xs text-[var(--foreground)] whitespace-nowrap";

/** Static metadata chip. */
export function Tag(
  { className, children, ref, ...props }: React.HTMLAttributes<HTMLSpanElement> & {
    ref?: React.Ref<HTMLSpanElement>;
  },
): React.ReactElement {
  return (
    <span ref={ref} className={cn(tagClasses, className)} {...props}>
      {children}
    </span>
  );
}

/** Props accepted by `<TagLink>`. */
export interface TagLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Destination URL — opens in a new tab with `rel="noopener noreferrer"`. */
  href: string;
  /** Render as a Slot, merging props onto the child element. */
  asChild?: boolean;
  ref?: React.Ref<HTMLAnchorElement>;
}

/** Tag rendered as an external link. */
export function TagLink(
  { className, asChild = false, ref, ...props }: TagLinkProps,
): React.ReactElement {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      ref={ref}
      className={cn(
        tagClasses,
        "hover:bg-[var(--tertiary)] transition-colors",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  );
}

/** Tag rendered as a button. */
export function TagButton(
  { className, asChild = false, type, ref, ...props }:
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & {
      /** Render as a Slot, merging props onto the child element. */
      asChild?: boolean;
      ref?: React.Ref<HTMLButtonElement>;
    },
): React.ReactElement {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? type : (type ?? "button")}
      className={cn(
        tagClasses,
        "hover:bg-[var(--tertiary)] transition-colors",
        className,
      )}
      {...props}
    />
  );
}

/** Wrapping container for a row of tags. */
export function TagGroup(
  { className, children, ref, ...props }: React.HTMLAttributes<HTMLDivElement> & {
    ref?: React.Ref<HTMLDivElement>;
  },
): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}
