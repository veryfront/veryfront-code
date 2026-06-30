/**
 * `cva` — forked from class-variance-authority (Apache-2.0, © Joe Bell), inlined
 * so `veryfront/chat` takes no external `class-variance-authority` dependency.
 *
 * The runtime is faithful to upstream; the types are narrowed to what the chat
 * UI primitives use. Private to the chat module — not a public export.
 *
 * @module react/components/chat/ui/cva
 */
import { type ClassValue, clsx } from "#veryfront/utils/clsx.ts";

/** Re-export of the class joiner, matching upstream's `cx`. */
export const cx = clsx;

type VariantShape = Record<string, Record<string, ClassValue>>;

type VariantSelection<V extends VariantShape> = {
  [K in keyof V]?: keyof V[K] | null | undefined;
};

type CvaProps<V extends VariantShape> =
  & VariantSelection<V>
  & { class?: ClassValue; className?: ClassValue };

interface CvaConfig<V extends VariantShape> {
  variants?: V;
  compoundVariants?: Array<
    & Partial<{ [K in keyof V]: keyof V[K] | Array<keyof V[K]> }>
    & { class?: ClassValue; className?: ClassValue }
  >;
  defaultVariants?: VariantSelection<V>;
}

/** Extracts the variant props of a `cva` function, like upstream's helper. */
// deno-lint-ignore no-explicit-any
export type VariantProps<T extends (...args: any) => any> = Omit<
  NonNullable<Parameters<T>[0]>,
  "class" | "className"
>;

const falsyToString = (value: unknown): unknown =>
  typeof value === "boolean" ? String(value) : value === 0 ? "0" : value;

/** Build a class-name function from a base plus a variants config. */
export function cva<V extends VariantShape>(
  base?: ClassValue,
  config?: CvaConfig<V>,
): (props?: CvaProps<V>) => string {
  return (props) => {
    if (!config?.variants) {
      return cx(base, props?.class, props?.className);
    }
    const { variants, defaultVariants } = config;

    const variantClassNames = Object.keys(variants).map((variant) => {
      const variantProp = (props as Record<string, unknown> | undefined)
        ?.[variant];
      const defaultVariantProp = defaultVariants?.[variant as keyof V];
      if (variantProp === null) return null;
      const variantKey = String(
        falsyToString(variantProp) ?? falsyToString(defaultVariantProp) ?? "",
      );
      return variants[variant]?.[variantKey];
    });

    const resolved: Record<string, unknown> = { ...defaultVariants };
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value !== undefined) resolved[key] = value;
      }
    }

    const compoundClassNames = config.compoundVariants?.reduce<ClassValue[]>(
      (acc, compound) => {
        const { class: cvClass, className: cvClassName, ...selectors } =
          compound;
        const matches = Object.entries(selectors).every(([key, value]) =>
          Array.isArray(value)
            ? (value as unknown[]).includes(resolved[key])
            : resolved[key] === value
        );
        return matches ? [...acc, cvClass, cvClassName] : acc;
      },
      [],
    );

    return cx(
      base,
      variantClassNames,
      compoundClassNames,
      props?.class,
      props?.className,
    );
  };
}
