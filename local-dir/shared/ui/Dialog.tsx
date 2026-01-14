import { XIcon } from "https://esm.sh/lucide-react"
import { cn } from "@/shared/utils/utils"
import * as DialogPrimitive from "https://esm.sh/@radix-ui/react-dialog@1.0.3?external=react,react-dom"
import React from "react"

export const Dialog = DialogPrimitive.Root

export const DialogTrigger = DialogPrimitive.Trigger

export const DialogPortal = DialogPrimitive.Portal

export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = React.forwardRef(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-[900] bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  ),
)

export const DialogContent = React.forwardRef(
  ({ className, children, withClose = true, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-[1000] grid w-[calc(100%-3rem)] sm:w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-popover text-popover-foreground p-6 pb-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg max-h-[85%] overflow-y-scroll scrollbar-thin scrollbar-thumb-input-border scrollbar-track-transparent outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {withClose && (
          <DialogPrimitive.Close className="absolute right-3 top-3 size-7 inline-flex justify-center items-center rounded-md ring-offset-background transition-opacity focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 disabled:pointer-events-none data-[state=open]:bg-transparent data-[state=open]:text-muted-foreground text-muted hover:text-foreground focus:text-foreground border border-transparent focus:border focus:border-foreground/30">
            <XIcon className="size-3.5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
)

export const DialogHeader = ({ className, ...props }) => (
  <div
    className={cn("flex flex-col space-y-1.5 pt-1 text-left", className)}
    {...props}
  />
)

export const DialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
)

export const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-xl font-medium leading-none mb-1", className)}
    {...props}
  />
))

export const DialogDescription = React.forwardRef(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted", className)}
      {...props}
    />
  ),
)
