import { LibraryDetailBreadcrumb } from "@/features/libraries/ui/LibraryDetailBreadcrumb"
import { useRouter } from "@/lib/Router"
import {
  librariesConfig,
  useCasesConfig,
} from "@/shared/utils/componentsConfig"

export function LibraryDetailBreadcrumbContainer() {
  const router = useRouter()
  const library = librariesConfig.find(
    (library) => library.id === router.params.libraryId,
  )

  const useCase = useCasesConfig.find(
    (useCase) => useCase.id === router.query.useCase,
  )

  if (!library) {
    return null
  }

  return <LibraryDetailBreadcrumb library={library} useCase={useCase} />
}
