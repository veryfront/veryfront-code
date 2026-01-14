import { useRouter } from "@/lib/Router"
import { librariesConfig } from "@/shared/utils/componentsConfig"
import { ComponentsSectionContainer } from "@/features/components/containers/ComponentsSectionContainer"

export function LibraryDetailContainer() {
  const router = useRouter()
  const useCaseId = router.query.useCase
  const library = librariesConfig.find(
    (library) => library.id === router.params.libraryId,
  )

  return (
    <ComponentsSectionContainer
      libraryId={router.params.libraryId}
      useCaseId={useCaseId}
    />
  )
}
