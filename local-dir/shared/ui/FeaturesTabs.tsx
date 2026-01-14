import { cn } from "@/shared/utils/utils"
import * as TabsPrimitive from "https://esm.sh/@radix-ui/react-tabs@1.0.3?external=react,react-dom"
import React from "react"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export const TabRotationContext = React.createContext({
  activeValue: null,
  percentageComplete: 0,
  isActive: false,
})

export function useTabRotation() {
  const context = React.useContext(TabRotationContext)
  return context
}

export function Root({
  values = [],
  value,
  onValueChange,
  autoRotate,
  ...props
}) {
  const [activeValue, setActiveValue] = React.useState(value || values?.[0])
  const [timeRemaining, setTimeRemaining] = React.useState(autoRotate)
  const isRotateActive = !!autoRotate && values?.length > 0

  React.useEffect(() => {
    if (!isRotateActive) {
      return
    }

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev > 50) {
          return prev - 50
        } else if (prev <= 50 && prev > 0) {
          return 0
        }

        const currentIndex = values.indexOf(activeValue)

        if (currentIndex !== -1 && values.length > 0) {
          const nextIndex = (currentIndex + 1) % values.length
          setActiveValue(values[nextIndex])
        }
        return autoRotate
      })
    }, 50)

    return () => {
      clearInterval(interval)
    }
  }, [
    isRotateActive,
    autoRotate,
    activeValue,
    setActiveValue,
    values,
    timeRemaining,
  ])

  const percentageComplete = ((autoRotate - timeRemaining) / autoRotate) * 100

  function onTabChange(newValue) {
    if (autoRotate) {
      setActiveValue(newValue)
      setTimeRemaining(autoRotate)
    }
    if (onValueChange) {
      onValueChange(newValue)
    }
  }

  return (
    <TabRotationContext.Provider
      value={{ activeValue, percentageComplete, isActive: isRotateActive }}
    >
      <TabsPrimitive.Root
        value={activeValue}
        onValueChange={onTabChange}
        {...props}
      />
    </TabRotationContext.Provider>
  )
}

export function List({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn("flex flex-col gap-8 md:gap-10 lg:gap-12", className)}
      {...props}
    />
  )
}

export function Tab({ children, className, value, ...props }) {
  const rotation = useTabRotation()
  const isActiveTab = rotation.activeValue === value

  return (
    <TabsPrimitive.Trigger
      className={cn(
        "group w-full flex flex-row items-center gap-5 lg:gap-6 text-left text-card-foreground/50 data-[state=active]:text-foreground ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      value={value}
      {...props}
    >
      <span
        role="presentation"
        className="block bg-card-foreground/20 w-1.5 min-h-full self-stretch rounded-sm grow-0 shrink-0 transition-all relative overflow-hidden"
      >
        {rotation.isActive && isActiveTab && (
          <span
            className={
              "bg-primary rounded-sm absolute top-0 left-0 right-0 h-full"
            }
            style={{ height: rotation.percentageComplete + "%" }}
          />
        )}
        {!rotation.isActive && (
          <span className="group-data-[state=active]:bg-primary rounded-sm absolute inset-0" />
        )}
      </span>
      <span className="flex flex-col gap-2.5 pt-0.5 pb-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  )
}

export function Title({ className, ...props }) {
  return <Heading as="h3" level="3" className={cn("", className)} {...props} />
}

export function Description({ className, ...props }) {
  return <Text as="p" className={cn("", className)} {...props} />
}

export function Content({ className, ...props }) {
  return <TabsPrimitive.Content className={cn("", className)} {...props} />
}
