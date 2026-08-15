/**
 * Field: a form-field wrapper that wires a label, description, and error to a
 * single control for accessibility. `<Field>` derives a stable base id with
 * `React.useId()` and shares it (plus derived description/error ids and the
 * `invalid` flag) through context, so `<FieldLabel>` targets the control via
 * `htmlFor`, `<FieldControl>` clones its child with the matching `id` +
 * `aria-describedby` + `aria-invalid`, and `<FieldDescription>` / `<FieldError>`
 * expose the referenced ids. Self-contained; skinned with the veryfront theme
 * tokens.
 *
 * @example
 * ```tsx
 * import { Field, FieldLabel, FieldControl, FieldDescription, FieldError } from "veryfront/ui";
 * import { Input } from "veryfront/ui";
 *
 * <Field invalid>
 *   <FieldLabel>Email</FieldLabel>
 *   <FieldControl><Input type="email" /></FieldControl>
 *   <FieldDescription>Veryfront never shares it.</FieldDescription>
 *   <FieldError>Enter a valid email.</FieldError>
 * </Field>;
 * ```
 *
 * @module react/components/ui/field
 */
import * as React from "react";
import { composeRefs } from "#veryfront/react/components/ui/slot.tsx";
import { cx as cn } from "./cva.ts";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect.ts";

interface FieldContextValue {
  /** Base id shared by the control and its `<FieldLabel htmlFor>`. */
  id: string;
  /** Id of the `<FieldDescription>` node, referenced by `aria-describedby`. */
  descriptionId: string;
  /** Id of the `<FieldError>` node, referenced by `aria-describedby` when invalid. */
  errorId: string;
  /** Whether the field is in an invalid state. */
  invalid: boolean;
  /** Whether a `<FieldDescription>` is present in this field's subtree. */
  descriptionPresent: boolean;
  /** Whether a `<FieldError>` will render (it renders nothing when empty). */
  errorPresent: boolean;
  /** Register a description rendered through an opaque wrapper component. */
  registerDescription: () => () => void;
  /** Register a non-empty error rendered through an opaque wrapper component. */
  registerError: () => () => void;
}

/**
 * Walks the element tree looking for a rendered `<FieldDescription>` and a
 * non-empty `<FieldError>`.
 *
 * Presence is resolved synchronously from `children` rather than registered
 * from an effect: `FieldControl` renders before any child effect runs, so an
 * effect-based registry would emit `aria-describedby` a commit too late (and
 * never at all in a non-`act` render).
 */
function findFieldParts(
  children: React.ReactNode,
  found: {
    description: boolean;
    error: boolean;
    descriptionId?: string;
    errorId?: string;
  } = { description: false, error: false },
): { description: boolean; error: boolean; descriptionId?: string; errorId?: string } {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === FieldDescription) {
      found.description = true;
      const props = child.props as { id?: unknown; children?: React.ReactNode };
      if (typeof props.id === "string") found.descriptionId ??= props.id;
    } else if (child.type === FieldError) {
      const props = child.props as { id?: unknown; children?: React.ReactNode };
      if (React.Children.count(props.children) > 0) found.error = true;
      if (typeof props.id === "string") found.errorId ??= props.id;
    }
    const props = child.props as { children?: React.ReactNode };
    if (props?.children) findFieldParts(props.children, found);
  });
  return found;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useField(part: string): FieldContextValue {
  const ctx = React.useContext(FieldContext);
  if (!ctx) throw new Error(`<${part}> must be used within <Field>`);
  return ctx;
}

/** Props accepted by `<Field>`. */
export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Mark the field invalid: flags the label/control/error via context. @default false */
  invalid?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The field wrapper: derives ids and provides them to its sub-parts. */
export function Field({
  invalid = false,
  className,
  children,
  ref,
  ...props
}: FieldProps): React.ReactElement {
  const base = React.useId();
  const staticParts = findFieldParts(children);
  const [mountedDescriptions, setMountedDescriptions] = React.useState(0);
  const [mountedErrors, setMountedErrors] = React.useState(0);
  const descriptionId = staticParts.descriptionId ?? `${base}-description`;
  const errorId = staticParts.errorId ?? `${base}-error`;
  const registerDescription = React.useCallback(() => {
    setMountedDescriptions((count) => count + 1);
    return () => setMountedDescriptions((count) => Math.max(0, count - 1));
  }, []);
  const registerError = React.useCallback(() => {
    setMountedErrors((count) => count + 1);
    return () => setMountedErrors((count) => Math.max(0, count - 1));
  }, []);
  const descriptionPresent = staticParts.description || mountedDescriptions > 0;
  const errorPresent = staticParts.error || mountedErrors > 0;
  const ctx = React.useMemo<FieldContextValue>(
    () => ({
      id: base,
      descriptionId,
      errorId,
      invalid,
      descriptionPresent,
      errorPresent,
      registerDescription,
      registerError,
    }),
    [
      base,
      descriptionId,
      errorId,
      invalid,
      descriptionPresent,
      errorPresent,
      registerDescription,
      registerError,
    ],
  );
  return (
    <FieldContext.Provider value={ctx}>
      <div
        ref={ref}
        data-invalid={invalid || undefined}
        className={cn("space-y-2", className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  );
}

/** Props accepted by `<FieldLabel>`. */
export interface FieldLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLLabelElement>;
}

/** The field's label: wired to the control with `htmlFor`. */
export function FieldLabel({
  className,
  children,
  ref,
  ...props
}: FieldLabelProps): React.ReactElement {
  const ctx = useField("FieldLabel");
  return (
    <label
      ref={ref}
      htmlFor={ctx.id}
      data-invalid={ctx.invalid || undefined}
      className={cn(
        "text-sm font-medium",
        ctx.invalid && "text-[var(--destructive)]",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}

/** Props accepted by `<FieldControl>`. */
export interface FieldControlProps {
  /** The single form control element to wire: its `id`/`aria-*` are set for you. */
  children: React.ReactElement;
  /** React 19: ref is forwarded onto the cloned child control (not a wrapper node). */
  ref?: React.Ref<HTMLElement>;
}

/**
 * Wiring wrapper: renders no node of its own; clones its single child control
 * with the shared `id`, `aria-describedby` (the description, plus the error id
 * when invalid), and `aria-invalid`.
 */
export function FieldControl({ children, ref }: FieldControlProps): React.ReactElement {
  const ctx = useField("FieldControl");
  const child = React.Children.only(children) as React.ReactElement<
    Record<string, unknown> & { ref?: React.Ref<HTMLElement> }
  >;
  const childRef = child.props.ref;
  // Reference an id only while its node is actually mounted, otherwise
  // aria-describedby points at nothing and assistive tech resolves no text.
  // The child's own aria-describedby is preserved and merged, not replaced.
  const describedBy = [
    typeof child.props["aria-describedby"] === "string" ? child.props["aria-describedby"] : null,
    ctx.descriptionPresent ? ctx.descriptionId : null,
    ctx.invalid && ctx.errorPresent ? ctx.errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return React.cloneElement(child, {
    id: ctx.id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": ctx.invalid || undefined,
    // Compose so a ref set directly on the child control still receives the node.
    ref: ref || childRef ? composeRefs<HTMLElement>(ref, childRef) : undefined,
  });
}

/** Props accepted by `<FieldDescription>`. */
export interface FieldDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLParagraphElement>;
}

/** Helper text describing the field: referenced by the control's `aria-describedby`. */
export function FieldDescription({
  className,
  children,
  id,
  ref,
  ...props
}: FieldDescriptionProps): React.ReactElement {
  const ctx = useField("FieldDescription");
  useIsomorphicLayoutEffect(() => ctx.registerDescription(), [ctx.registerDescription]);
  return (
    <p
      ref={ref}
      id={id ?? ctx.descriptionId}
      className={cn("text-sm text-[var(--muted-foreground)]", className)}
      {...props}
    >
      {children}
    </p>
  );
}

/** Props accepted by `<FieldError>`. */
export interface FieldErrorProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLParagraphElement>;
}

/** The field's error message: a live `role="alert"`; renders nothing when empty. */
export function FieldError({
  className,
  children,
  id,
  ref,
  ...props
}: FieldErrorProps): React.ReactElement | null {
  const ctx = useField("FieldError");
  const present = React.Children.count(children) > 0;
  useIsomorphicLayoutEffect(
    () => present ? ctx.registerError() : undefined,
    [ctx.registerError, present],
  );
  if (!present) return null;
  return (
    <p
      ref={ref}
      id={id ?? ctx.errorId}
      role="alert"
      data-invalid={ctx.invalid || undefined}
      className={cn("text-sm text-[var(--destructive)]", className)}
      {...props}
    >
      {children}
    </p>
  );
}
