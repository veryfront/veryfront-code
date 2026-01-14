import { Container } from "@/shared/ui/Container"
import { CardSkeleton } from "@/shared/ui/CardSkeleton"
import { LibraryCard } from "@/features/libraries/ui/LibraryCard"

export function LibrariesList({ libraries = [], isLoading, isEmpty }) {
  if (isEmpty) {
    return (
      <Container>
        <div className="py-12 text-center text-muted">
          <p>No libraries found</p>
        </div>
      </Container>
    )
  }

  if (!Array.isArray(libraries)) {
    return null
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
      {isLoading ? (
        <>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </>
      ) : (
        <>
          {libraries?.map((library) => (
            <LibraryCard key={library.id} library={library} />
          ))}
        </>
      )}
    </div>
  )
}
