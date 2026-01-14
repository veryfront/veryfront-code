import { Container } from "@/shared/ui/Container"
import * as Section from "@/shared/ui/Section"
import { ComponentsSectionCard } from "@/features/components/ui/ComponentsSectionCard"
import { Heading } from "@/shared/ui/Heading"
import { CardSkeleton } from "@/shared/ui/CardSkeleton"
import { Text } from "@/shared/ui/Text"
import { ChevronRight } from "https://esm.sh/lucide-react"
import { cn } from "@/shared/utils/utils"

function Header({ children }) {
  return (
    <Heading as="h3" level="4" className="mb-4 font-normal flex items-center">
      {children}
    </Heading>
  )
}

export function ComponentsSection({
  library,
  useCase,
  categories = [],
  isLoading,
  isFetching,
  isEmpty,
  colorMode,
  showBreadcrumb = true,
}) {
  return (
    <section>
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <div className="flex flex-col items-stretch gap-10">
          {isEmpty ? (
            <div className="py-12 text-center text-muted">
              <p>No components found</p>
            </div>
          ) : (
            categories?.map((category) => (
              <div key={category.name}>
                {showBreadcrumb && (
                  <Header>
                    {/*library && (
                        <>
                          {library.title}{" "}
                          <ChevronRight className="text-muted size-3.5 mx-1" />
                        </>
                      )*/}
                    {useCase && (
                      <>
                        {useCase.title}{" "}
                        <ChevronRight className="text-muted size-3.5 mx-1" />
                      </>
                    )}
                    {category.name}
                  </Header>
                )}

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {category.sections?.map((section) => (
                    <ComponentsSectionCard
                      key={category.name + section.name}
                      library={library}
                      useCase={useCase}
                      category={category}
                      section={section}
                      colorMode={colorMode}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
