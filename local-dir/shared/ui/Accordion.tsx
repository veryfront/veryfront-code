import { ChevronDownIcon } from "https://esm.sh/lucide-react"
import { cn } from "@/shared/utils/utils"
import * as AccordionPrimitive from "https://esm.sh/@radix-ui/react-accordion@1.1.1?external=react,react-dom"
import React from "react"

export const Accordion = AccordionPrimitive.Root

export const AccordionItem = React.forwardRef(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Item
      ref={ref}
      className={cn("border-b border-b-divider last:border-none", className)}
      {...props}
    />
  ),
)

export const AccordionTrigger = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          "flex flex-1 text-sm xs:text-base sm:text-lg text-left items-center justify-between py-5 md:py-6 font-medium [&[data-state=open]>svg]:rotate-180 tracking-wide w-full focus-visible:outline-none focus-visible:underline-offset-8 focus-visible:underline focus-visible:decoration-2",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          height={24}
          width={24}
          className="transition-transform duration-200 shrink-0 ml-2"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  ),
)

export const AccordionContent = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Content
      ref={ref}
      className={cn(
        "overflow-hidden text-sm sm:text-base transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down will-change-[height] tracking-wide pb-8",
        className,
      )}
      {...props}
    >
      {children}
    </AccordionPrimitive.Content>
  ),
)
