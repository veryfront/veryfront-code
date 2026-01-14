import { Card } from "@/shared/ui/Card"
import { cn } from "@/shared/utils/utils"

interface CardSkeletonProps {
  className?: string
}

export function CardSkeleton({ className }: CardSkeletonProps) {
  return (
    <Card className={cn("p-4 aspect-[8/6.35] min-h-0", className)}>
      <div
        role="status"
        className="animate-pulse flex flex-col gap-3 justify-end h-full"
      >
        <div className="h-2 bg-gray-200 rounded-ms dark:bg-gray-700 w-[62.5%]"></div>
        <div className="h-2 bg-gray-200 rounded-ms dark:bg-gray-700 max-w-[93.75%]"></div>
        <div className="h-2 bg-gray-200 rounded-ms dark:bg-gray-700 w-[100%]"></div>
        <div className="h-2 bg-gray-200 rounded-ms dark:bg-gray-700 max-w-[85.94%]"></div>
        <div className="h-2 bg-gray-200 rounded-ms dark:bg-gray-700 max-w-[78.13%]"></div>
        <div className="h-2 bg-gray-200 rounded-ms dark:bg-gray-700 max-w-[93.75%]"></div>
        <span className="sr-only">Loading...</span>
      </div>
    </Card>
  )
}
