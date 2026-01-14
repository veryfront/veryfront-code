import { type VariantProps } from "class-variance-authority"
import React from "react"
import { cn, cva } from "@/shared/utils/utils"
import { Button } from "@/shared/ui/Button"
import { XIcon } from "https://esm.sh/lucide-react"

export const inputVariants = cva(
  "flex h-10 w-full rounded-md border text-base text-input-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium file:input-foreground placeholder:input-placeholder disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[invalid=true]:border-destructive data-[invalid=true]:ring-destructive",
  {
    variants: {
      variant: {
        solid: "bg-input border-input-border/70",
        outline: "bg-transparent border-input-border",
      },
      size: {
        xs: "h-8 px-2.5 py-1",
        sm: "h-9 px-2.5 py-1",
        md: "h-10 px-3 py-2",
        lg: "h-11 px-3 py-2",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  },
)

interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix" | "size">,
    VariantProps<typeof inputVariants> {
  prefix?: React.ReactNode
  beforeIcon?: React.ReactNode
  suffix?: React.ReactNode
  afterIcon?: React.ReactNode
  withClear?: boolean
  onClear?: () => void
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      prefix,
      suffix,
      beforeIcon,
      afterIcon,
      variant,
      size,
      withClear,
      onChange,
      onClear,
      ...props
    },
    ref,
  ) => {
    const [hasValue, setHasValue] = React.useState(
      !!props.defaultValue || !!props.value,
    )

    return (
      <div
        className={cn(
          "flex flex-1 items-center relative group",
          props.disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {prefix && (
          <span className="border border-input-border border-r-0 self-stretch px-3.5 flex items-center shrink-0 rounded-l-md bg-inherit text-muted md:text-sm">
            {prefix}
          </span>
        )}
        <div className="relative flex items-center flex-1">
          {beforeIcon && (
            <span className="absolute left-3 pointer-events-none text-muted z-10">
              {beforeIcon}
            </span>
          )}

          <input
            className={cn(
              inputVariants({ variant, size, className }),
              prefix && "rounded-l-none",
              beforeIcon && "pl-[2.325rem]",
              suffix && "rounded-r-none",
              afterIcon && "pr-[3rem]",
              withClear && "pr-9",
              withClear && afterIcon && "pr-[calc(3rem + theme(spacing.9))]",
              props.disabled && "disabled:opacity-100",
            )}
            ref={ref}
            data-1p-ignore="true"
            onChange={(event) => {
              setHasValue(!!event.currentTarget.value)
              onChange?.(event)
            }}
            {...props}
          />

          {afterIcon && (
            <span className="absolute right-3 pointer-events-none text-muted">
              {afterIcon}
            </span>
          )}
        </div>
        {suffix && (
          <span className="border border-input-border border-l-0 self-stretch px-3.5 flex items-center shrink-0 rounded-r-md bg-inherit text-muted md:text-sm">
            {suffix}
          </span>
        )}

        {withClear && hasValue && (
          <div
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 z-10",
              size === "sm" && "right-1.5",
            )}
          >
            <Button
              variant="icon"
              className="w-6 h-6 focus-visible:outline-none rounded-sm focus:border-input-border"
              type="button"
              onClick={() => {
                if (onClear) {
                  onClear()
                }
                setHasValue(false)
              }}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    )
  },
)
