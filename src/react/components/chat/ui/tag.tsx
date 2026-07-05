/**
 * Tag — ported 1:1 from Veryfront Studio. A small rounded chip for metadata /
 * labels, with link and button affordances plus a wrapping group. Semantic
 * classes remapped to veryfront's `[var(--token)]` vocabulary. Private to the
 * chat module.
 *
 * @module react/components/chat/ui/tag
 */
import * as React from "react";
import { cn } from "../theme.ts";

const tagClasses =
  "inline-flex items-center rounded-full bg-[var(--edge)] px-3 py-1 text-xs text-[var(--foreground)] whitespace-nowrap";

/** Static metadata chip. */
export function Tag(
  { className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>,
): React.ReactElement {
  return (
    <span className={cn(tagClasses, className)} {...props}>
      {children}
    </span>
  );
}

/** Props accepted by `<TagLink>`. */
export interface TagLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/** Tag rendered as an external link. */
export function TagLink(
  { className, ...props }: TagLinkProps,
): React.ReactElement {
  return (
    <a
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
  { className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>,
): React.ReactElement {
  return (
    <button
      type="button"
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
  { className, children, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}
