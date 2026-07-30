/**
 * Breadcrumb — a non-interactive navigation trail showing the current page's
 * location within a hierarchy. Pure-structure primitive (no engine needed): a
 * labelled `<nav>` wrapping an ordered `<BreadcrumbList>` of `<BreadcrumbItem>`s,
 * with `<BreadcrumbLink>`s for ancestors, a single `<BreadcrumbPage>` for the
 * current page (`aria-current="page"`), decorative `<BreadcrumbSeparator>`s
 * between them, and an optional `<BreadcrumbEllipsis>` to collapse a long trail.
 * Skinned with the veryfront theme tokens.
 *
 * @example
 * ```tsx
 * import {
 *   Breadcrumb,
 *   BreadcrumbList,
 *   BreadcrumbItem,
 *   BreadcrumbLink,
 *   BreadcrumbSeparator,
 *   BreadcrumbPage,
 * } from "veryfront/ui";
 *
 * <Breadcrumb>
 *   <BreadcrumbList>
 *     <BreadcrumbItem>
 *       <BreadcrumbLink href="/">Home</BreadcrumbLink>
 *     </BreadcrumbItem>
 *     <BreadcrumbSeparator />
 *     <BreadcrumbItem>
 *       <BreadcrumbPage>Settings</BreadcrumbPage>
 *     </BreadcrumbItem>
 *   </BreadcrumbList>
 * </Breadcrumb>;
 * ```
 *
 * @module react/components/ui/breadcrumb
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<Breadcrumb>`. */
export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLElement>;
}

/** The landmark `<nav aria-label="Breadcrumb">` wrapping the trail. */
export function Breadcrumb({
  className,
  children,
  ref,
  ...props
}: BreadcrumbProps): React.ReactElement {
  return (
    <nav
      ref={ref}
      aria-label="Breadcrumb"
      data-slot="breadcrumb"
      className={className}
      {...props}
    >
      {children}
    </nav>
  );
}

/** Props accepted by `<BreadcrumbList>`. */
export interface BreadcrumbListProps extends React.OlHTMLAttributes<HTMLOListElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLOListElement>;
}

/** The ordered list of trail items. */
export function BreadcrumbList({
  className,
  children,
  ref,
  ...props
}: BreadcrumbListProps): React.ReactElement {
  return (
    <ol
      ref={ref}
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-1.5 break-words text-sm text-[var(--muted-foreground)] sm:gap-2.5",
        className,
      )}
      {...props}
    >
      {children}
    </ol>
  );
}

/** Props accepted by `<BreadcrumbItem>`. */
export interface BreadcrumbItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLLIElement>;
}

/** A single item in the trail — wraps a link, the current page, or an ellipsis. */
export function BreadcrumbItem({
  className,
  children,
  ref,
  ...props
}: BreadcrumbItemProps): React.ReactElement {
  return (
    <li
      ref={ref}
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    >
      {children}
    </li>
  );
}

/** Props accepted by `<BreadcrumbLink>`. */
export interface BreadcrumbLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLAnchorElement>;
}

/** A navigable ancestor link in the trail. */
export function BreadcrumbLink({
  className,
  children,
  ref,
  ...props
}: BreadcrumbLinkProps): React.ReactElement {
  return (
    <a
      ref={ref}
      data-slot="breadcrumb-link"
      className={cn("transition-colors hover:text-[var(--foreground)]", className)}
      {...props}
    >
      {children}
    </a>
  );
}

/** Props accepted by `<BreadcrumbPage>`. */
export interface BreadcrumbPageProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLSpanElement>;
}

/** The current page — a non-interactive `role="link"` marked `aria-current="page"`. */
export function BreadcrumbPage({
  className,
  children,
  ref,
  ...props
}: BreadcrumbPageProps): React.ReactElement {
  return (
    <span
      ref={ref}
      role="link"
      aria-disabled="true"
      aria-current="page"
      data-slot="breadcrumb-page"
      className={cn("font-normal text-[var(--foreground)]", className)}
      {...props}
    >
      {children}
    </span>
  );
}

/** Props accepted by `<BreadcrumbSeparator>`. */
export interface BreadcrumbSeparatorProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLLIElement>;
}

/** A decorative divider between items; renders its children or a default `/`. */
export function BreadcrumbSeparator({
  className,
  children,
  ref,
  ...props
}: BreadcrumbSeparatorProps): React.ReactElement {
  return (
    <li
      ref={ref}
      role="presentation"
      aria-hidden="true"
      data-slot="breadcrumb-separator"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? "/"}
    </li>
  );
}

/** Props accepted by `<BreadcrumbEllipsis>`. */
export interface BreadcrumbEllipsisProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLSpanElement>;
}

/** A collapsed-trail indicator — renders `…` with an sr-only "More" label. */
export function BreadcrumbEllipsis({
  className,
  ref,
  ...props
}: BreadcrumbEllipsisProps): React.ReactElement {
  return (
    <span
      ref={ref}
      role="presentation"
      aria-hidden="true"
      data-slot="breadcrumb-ellipsis"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      …
      <span className="sr-only">More</span>
    </span>
  );
}
