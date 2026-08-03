/**
 * `Slot` - forked from @radix-ui/react-slot (MIT, © WorkOS), inlined so
 * `veryfront/chat` takes no external Radix dependency. Merges its props onto a
 * single child element (the `asChild` pattern): className is concatenated,
 * style is shallow-merged, event handlers are chained (child first by default),
 * and refs are composed. The `disabled` contract gives composed controls a
 * capture-phase gate that suppresses primary, auxiliary, keyboard, and default
 * activation across Slot and child handlers.
 *
 * Scoped to the single-child case Veryfront's UI primitives use; Radix's
 * `Slottable`/lazy-children handling is intentionally omitted.
 *
 * @module react/components/ui/slot
 */
import * as React from "react";

type AnyProps = Record<string, unknown>;
type RefCleanup = () => void;

/** Element attributes used by a control that may slot a native button. */
export type PolymorphicButtonAttributes<T extends HTMLElement> = T extends HTMLButtonElement
  ? React.ButtonHTMLAttributes<HTMLButtonElement>
  : React.HTMLAttributes<T>;

/**
 * Resolve button submission semantics for a native or slotted control.
 * Native controls and intrinsic slotted buttons default to `type="button"`.
 * Intrinsic non-buttons and opaque components never receive a button-only
 * attribute; an opaque component that renders a button must own its `type`.
 */
export function getPolymorphicButtonType(
  asChild: boolean | undefined,
  child: React.ReactNode,
): "button" | undefined;
export function getPolymorphicButtonType(
  asChild: boolean | undefined,
  child: React.ReactNode,
  type: React.ButtonHTMLAttributes<HTMLButtonElement>["type"],
): React.ButtonHTMLAttributes<HTMLButtonElement>["type"] | undefined;
export function getPolymorphicButtonType(
  asChild: boolean | undefined,
  child: React.ReactNode,
  type?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"],
): React.ButtonHTMLAttributes<HTMLButtonElement>["type"] | undefined {
  if (!asChild) return type ?? "button";
  if (!React.isValidElement(child) || child.type !== "button") return undefined;
  return type ?? "button";
}

const REACT_MAJOR_VERSION = Number.parseInt(React.version, 10);
const SUPPORTS_REF_CLEANUP = Number.isFinite(REACT_MAJOR_VERSION) &&
  REACT_MAJOR_VERSION >= 19;

function getElementRef(
  element: React.ReactElement,
  props: AnyProps,
): React.Ref<HTMLElement> | undefined {
  if (SUPPORTS_REF_CLEANUP) {
    return props.ref as React.Ref<HTMLElement> | undefined;
  }
  if (
    Number.isFinite(REACT_MAJOR_VERSION) &&
    REACT_MAJOR_VERSION > 0 &&
    REACT_MAJOR_VERSION < 19
  ) {
    return (element as React.ReactElement & { ref?: React.Ref<HTMLElement> })
      .ref;
  }
  return props.ref as React.Ref<HTMLElement> | undefined;
}

function attachRef<T>(ref: React.Ref<T> | undefined, node: T): RefCleanup {
  if (typeof ref === "function") {
    const cleanup = ref(node);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (ref != null) {
    ref.current = node;
    return () => {
      if (ref.current === node) ref.current = null;
    };
  }
  return () => undefined;
}

function runCleanups(cleanups: RefCleanup[]): void {
  let firstError: unknown;
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      cleanups[index]!();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

/** Compose multiple refs into one callback ref. */
export function composeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  let assignment: { cleanups: RefCleanup[]; node: T } | undefined;

  const detach = (node?: T): void => {
    if (!assignment || (node !== undefined && assignment.node !== node)) return;
    const { cleanups } = assignment;
    assignment = undefined;
    runCleanups(cleanups);
  };

  return (node) => {
    if (node === null) {
      detach();
      return;
    }

    detach();
    const cleanups: RefCleanup[] = [];
    try {
      for (const ref of refs) {
        cleanups.push(attachRef(ref, node));
      }
    } catch (error) {
      runCleanups(cleanups);
      throw error;
    }
    assignment = { cleanups, node };

    if (SUPPORTS_REF_CLEANUP) {
      return () => detach(node);
    }
  };
}

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const overrideProps: AnyProps = { ...childProps };
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    if (/^on[A-Z]/.test(propName)) {
      // Chain handlers: child runs first, then the slot's.
      if (
        typeof slotPropValue === "function" &&
        typeof childPropValue === "function"
      ) {
        overrideProps[propName] = (...args: unknown[]) => {
          (childPropValue as (...a: unknown[]) => void)(...args);
          const event = args[0] as { defaultPrevented?: boolean } | undefined;
          if (event?.defaultPrevented !== true) {
            (slotPropValue as (...a: unknown[]) => void)(...args);
          }
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = {
        ...(slotPropValue as object),
        ...(childPropValue as object),
      };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean)
        .join(" ");
    }
  }
  return { ...slotProps, ...overrideProps };
}

/** Props accepted by `<Slot>`. */
export interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  /** Block activation when an asChild consumer uses non-native disabled markup. */
  disabled?: boolean;
  /** Button submission behavior for slotted button-like controls. */
  type?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
}

function preventDisabledActivation(event: React.SyntheticEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function preventDisabledKeyboardActivation(event: React.KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") preventDisabledActivation(event);
}

const NATIVELY_DISABLEABLE_ELEMENTS = new Set([
  "button",
  "fieldset",
  "input",
  "optgroup",
  "option",
  "select",
  "textarea",
]);

/** Render `Slot` — merge props onto its single child element. */
export const Slot: React.ForwardRefExoticComponent<
  SlotProps & React.RefAttributes<HTMLElement>
> = React.forwardRef<HTMLElement, SlotProps>(
  function Slot({ children, disabled = false, ...slotProps }, forwardedRef) {
    if (!React.isValidElement(children)) {
      throw new TypeError("Slot requires exactly one valid React element child");
    }
    const child = children;
    const childProps = child.props as AnyProps;
    const childRef = getElementRef(child, childProps);
    const mergedRef = React.useMemo(
      () => forwardedRef || childRef ? composeRefs(forwardedRef, childRef) : undefined,
      [forwardedRef, childRef],
    );

    const merged = mergeProps(slotProps as AnyProps, childProps);
    if (disabled) {
      merged["aria-disabled"] = true;
      merged.tabIndex = -1;
      if ("href" in merged) merged.href = undefined;
      merged.onAuxClickCapture = preventDisabledActivation;
      merged.onAuxClick = preventDisabledActivation;
      merged.onClickCapture = preventDisabledActivation;
      merged.onClick = preventDisabledActivation;
      merged.onKeyDownCapture = preventDisabledKeyboardActivation;
      merged.onKeyUpCapture = preventDisabledKeyboardActivation;
      merged.onKeyUp = preventDisabledKeyboardActivation;
      if (
        typeof child.type === "string" &&
        NATIVELY_DISABLEABLE_ELEMENTS.has(child.type)
      ) {
        merged.disabled = true;
      } else {
        delete merged.disabled;
      }
    }
    merged.ref = mergedRef;
    return React.cloneElement(
      child,
      merged as Record<string, never>,
    );
  },
);
