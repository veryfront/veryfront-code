import { LibraryDetailHero } from "@/features/libraries/ui/LibraryDetailHero"
import { useRouter } from "@/lib/Router"
import { librariesConfig } from "@/shared/utils/componentsConfig"

export function LibraryDetailHeroContainer() {
  const router = useRouter()
  const library = librariesConfig.find(
    (library) => library.id === router.params.libraryId,
  )

  if (!library) {
    return null
  }

  return (
    <LibraryDetailHero
      title={library.title}
      description={library.description}
      icon={<library.icon className="size-8 md:size-12" />}
    />
  )
}
