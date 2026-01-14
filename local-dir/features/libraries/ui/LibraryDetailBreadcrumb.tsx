import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
} from "@/shared/ui/Breadcrumb"
import { Container } from "@/shared/ui/Container"
import { Head } from "@/lib/Head"

export function LibraryDetailBreadcrumb({ library, useCase }) {
  return (
    <>
      <Head>
        <title>
          {[useCase?.title, library?.title, "Libraries", "Veryfront"]
            .filter(Boolean)
            .join(" — ")}
        </title>
      </Head>
      <Container className="pt-3 md:pt-5">
        <Breadcrumb>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <BreadcrumbLink href="/libraries">Libraries</BreadcrumbLink>
          </BreadcrumbItem>
          {useCase ? (
            <BreadcrumbItem>
              <BreadcrumbLink href={`/libraries/${library.id}`}>
                {library.title}
              </BreadcrumbLink>
            </BreadcrumbItem>
          ) : (
            <BreadcrumbItem isCurrent>{library.title}</BreadcrumbItem>
          )}

          {useCase && (
            <BreadcrumbItem isCurrent>{useCase.title}</BreadcrumbItem>
          )}
        </Breadcrumb>
      </Container>
    </>
  )
}
