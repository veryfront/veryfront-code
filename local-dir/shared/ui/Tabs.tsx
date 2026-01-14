import { cn } from "@/shared/utils/utils"
import * as TabsPrimitive from "https://esm.sh/@radix-ui/react-tabs@1.0.3?external=react,react-dom"
import React from "react"

export const Tabs = TabsPrimitive.Root

export const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded-md bg-secondary text-muted-foreground p-1",
      className,
    )}
    {...props}
  />
))

export const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md py-1.5 px-3.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-secondary-foreground data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
))

export const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("outline-0", className)}
    {...props}
  />
))
