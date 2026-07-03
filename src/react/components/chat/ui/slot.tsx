/**
 * `Slot` — forked from @radix-ui/react-slot (MIT, © WorkOS), inlined so
 * `veryfront/chat` takes no external Radix dependency. Merges its props onto a
 * single child element (the `asChild` pattern): className is concatenated,
 * style is shallow-merged, event handlers are chained (child first), and refs
 * are composed.
 *
 * Scoped to the single-child case the chat primitives use — Radix's
 * `Slottable`/lazy-children handling is intentionally omitted. Private to the
 * chat module.
 *
 * @module react/components/chat/ui/slot
 */
import * as React from "react";

type AnyProps = Record<string, unknown>;

/** Compose multiple refs into one callback ref. */
function composeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
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
          (slotPropValue as (...a: unknown[]) => void)(...args);
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
}

/** Render `Slot` — merge props onto its single child element. */
export const Slot: React.ForwardRefExoticComponent<
  SlotProps & React.RefAttributes<HTMLElement>
> = React.forwardRef<HTMLElement, SlotProps>(
  function Slot({ children, ...slotProps }, forwardedRef) {
    if (React.isValidElement(children)) {
      const childProps = (children.props ?? {}) as AnyProps;
      const childRef = (children as { ref?: React.Ref<HTMLElement> }).ref ??
        (childProps.ref as React.Ref<HTMLElement> | undefined);
      const merged = mergeProps(slotProps as AnyProps, childProps);
      merged.ref = forwardedRef ? composeRefs(forwardedRef, childRef) : childRef;
      return React.cloneElement(
        children as React.ReactElement,
        merged as Record<string, never>,
      );
    }
    return React.Children.count(children) > 1 ? React.Children.only(null) : null;
  },
);
