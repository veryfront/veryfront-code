/**
 * Pagination: a non-interactive compound for paging navigation. Structure is
 * modelled on shadcn's pagination (a landmark `<nav>` wrapping a `<ul>` of
 * `<li>` links) and restyled with the veryfront theme tokens. The active page is
 * a {@link PaginationLink} with `isActive` (→ `aria-current="page"`);
 * {@link PaginationPrevious}/{@link PaginationNext} are labelled link variants and
 * {@link PaginationEllipsis} marks a gap in the page sequence.
 *
 * @example
 * ```tsx
 * <Pagination>
 *   <PaginationContent>
 *     <PaginationItem><PaginationPrevious href="?page=1" /></PaginationItem>
 *     <PaginationItem><PaginationLink href="?page=1">1</PaginationLink></PaginationItem>
 *     <PaginationItem><PaginationLink href="?page=2" isActive>2</PaginationLink></PaginationItem>
 *     <PaginationItem><PaginationLink href="?page=3">3</PaginationLink></PaginationItem>
 *     <PaginationItem><PaginationEllipsis /></PaginationItem>
 *     <PaginationItem><PaginationNext href="?page=3" /></PaginationItem>
 *   </PaginationContent>
 * </Pagination>
 * ```
 *
 * @module react/components/ui/pagination
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<Pagination>`. */
export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLElement>;
}

/** The paging landmark: a centered `role="navigation"` region. */
export function Pagination({ className, ref, ...props }: PaginationProps): React.ReactElement {
  return (
    <nav
      ref={ref}
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

/** Props accepted by `<PaginationContent>`. */
export interface PaginationContentProps extends React.HTMLAttributes<HTMLUListElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLUListElement>;
}

/** The list of page items: a horizontal `<ul>`. */
export function PaginationContent(
  { className, ref, ...props }: PaginationContentProps,
): React.ReactElement {
  return (
    <ul
      ref={ref}
      data-slot="pagination-content"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

/** Props accepted by `<PaginationItem>`. */
export interface PaginationItemProps extends React.HTMLAttributes<HTMLLIElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLLIElement>;
}

/** A single page slot: an `<li>` wrapping a link or ellipsis. */
export function PaginationItem(
  { className, ref, ...props }: PaginationItemProps,
): React.ReactElement {
  return <li ref={ref} data-slot="pagination-item" className={className} {...props} />;
}

/** Props accepted by `<PaginationLink>`. */
export interface PaginationLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Marks this link as the current page: sets `aria-current="page"` and active styling. @default false */
  isActive?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** A page link: highlighted when `isActive`, otherwise hover-highlighted. */
export function PaginationLink(
  { className, isActive = false, ref, ...props }: PaginationLinkProps,
): React.ReactElement {
  return (
    <a
      ref={ref}
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive ? "" : undefined}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium",
        "transition-[background-color,color] duration-150 ease-in",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        isActive
          ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
          : "text-[var(--foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
        className,
      )}
      {...props}
    />
  );
}

/** Props accepted by `<PaginationPrevious>`. */
export interface PaginationPreviousProps extends PaginationLinkProps {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** A "‹ Previous" link: a labelled {@link PaginationLink} variant. */
export function PaginationPrevious(
  { className, children, ref, ...props }: PaginationPreviousProps,
): React.ReactElement {
  return (
    <PaginationLink
      ref={ref}
      aria-label="Go to previous page"
      data-slot="pagination-previous"
      className={cn("px-2.5", className)}
      {...props}
    >
      {children ?? (
        <>
          <span aria-hidden>‹</span>
          <span>Previous</span>
        </>
      )}
    </PaginationLink>
  );
}

/** Props accepted by `<PaginationNext>`. */
export interface PaginationNextProps extends PaginationLinkProps {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** A "Next ›" link: a labelled {@link PaginationLink} variant. */
export function PaginationNext(
  { className, children, ref, ...props }: PaginationNextProps,
): React.ReactElement {
  return (
    <PaginationLink
      ref={ref}
      aria-label="Go to next page"
      data-slot="pagination-next"
      className={cn("px-2.5", className)}
      {...props}
    >
      {children ?? (
        <>
          <span>Next</span>
          <span aria-hidden>›</span>
        </>
      )}
    </PaginationLink>
  );
}

/** Props accepted by `<PaginationEllipsis>`. */
export interface PaginationEllipsisProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLSpanElement>;
}

/** A non-interactive gap marker between page ranges. */
export function PaginationEllipsis(
  { className, ref, ...props }: PaginationEllipsisProps,
): React.ReactElement {
  return (
    <span
      ref={ref}
      role="presentation"
      data-slot="pagination-ellipsis"
      className={cn(
        "flex h-9 w-9 items-center justify-center text-sm text-[var(--muted-foreground)]",
        className,
      )}
      {...props}
    >
      <span aria-hidden>…</span>
      <span className="sr-only">More pages</span>
    </span>
  );
}
