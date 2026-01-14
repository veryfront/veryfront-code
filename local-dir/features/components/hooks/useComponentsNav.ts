import { useRouter } from "@/lib/Router"
import { useQuery } from "@tanstack/react-query"

const LIBRARIES_COMPONENT_SEARCH_QUERY = `
  query LibrariesComponentSearch($first: Int, $after: String, $before: String, $search: String, $filter: FilterParams) {
    librariesComponentSearch(first: $first, after: $after, before: $before, search: $search, filter: $filter) {
      edges {
        node {
          id
          categories {
            name
            sections {
              name
            }
          }
        }
      }
    }
  }
`

interface UseComponentsNavOptions {
  useCase: string
  library?: string
  category?: string
  section?: string
}

export function useComponentsNav({
  useCase = "all",
  library = "all",
  category = "all",
  section = "all",
}: UseComponentsNavOptions) {
  const router = useRouter()

  const filters = []

  if (library && library !== "all") {
    filters.push(`librarySlug:${library}`)
  }

  if (useCase && useCase !== "all") {
    filters.push(`useCase:${useCase}`)
  }

  if (category && category !== "all") {
    filters.push(`category:${category}`)
  }

  if (section && section !== "all") {
    filters.push(`section:${section}`)
  }

  const where = filters.join(",")
  const filter = where ? { where } : {}

  const { data, ...rest } = useQuery({
    queryKey: ["componentsNav", `where:${where}`],
    queryFn: async () => {
      const response = await fetch("https://api.veryfront.com/graphql", {
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          query: LIBRARIES_COMPONENT_SEARCH_QUERY,
          variables: {
            filter,
            first: 10000,
          },
        }),
      })

      const { data } = await response.json()
      return data?.librariesComponentSearch
    },
    keepPreviousData: (data) => data,
    refetchOnWindowFocus: false,
  })

  const categories = data ? data.edges?.[0]?.node?.categories : []

  return {
    categories,
    ...rest,
  }
}
