import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"
import { ChevronRight } from "https://esm.sh/lucide-react"

export function ComponentName({ componentName, variantName }) {
  return (
    <Heading as="h3" level="3" className="font-normal flex items-center">
      {componentName}

      {variantName && componentName !== variantName && (
        <>
          <ChevronRight className="text-muted size-3.5 mx-1" />

          {variantName}
        </>
      )}
    </Heading>
  )
}
