export const useCases = [
  {
    id: "Marketing",
    title: "Marketing",
    subtitle:
      "Integrate marketing UI components to elevate your next project's visual appeal and conversion rates.",
  },
  {
    id: "Application",
    title: "Application",
    subtitle:
      "Utilize application UI components to create a cohesive and intuitive user experience for your next project.",
  },
  {
    id: "Store",
    title: "Store",
    subtitle:
      "Use store UI components to enhance user navigation and boost conversions in your next project.",
    isDisabled: true,
  },
  {
    id: "Survey",
    title: "Survey",
    subtitle: "<todo>",
    isDisabled: true,
  },
]

export const fetchTemplates = async function () {
  const response = await fetch("https://veryfront.com/api/templates")
  if (!response.ok) {
    throw new Error("Network response was not ok")
  }
  return response.json()
}

export const fetchLibraries = async function () {
  const response = await fetch("https://veryfront.com/api/libraries")
  if (!response.ok) {
    throw new Error("Network response was not ok")
  }
  return response.json()
}

export const useCasesQuery = `
  query LibrariesComponentSearch($first: Int, $after: String, $before: String, $search: String, $filter: FilterParams) {
    librariesComponentSearch(first: $first, after: $after, before: $before, search: $search, filter: $filter) {
      edges {
        node {
          id
          categories {
            name
            sections {
              name
              components {
                id
                name
                slug
                importPath
                categoryName
                sectionName
                frontmatter
                variants {
                  id
                  name
                  slug
                  importPath
                  categoryName
                  sectionName
                  frontmatter
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`

export const fetchComponentCategories = async function (useCase) {
  const library = "veryfront-ui"
  const section = "all"
  const category = "all"
  const limit = 1000
  const search = ""

  const filters = []

  if (library && library !== "all") {
    filters.push(`librarySlug:${library}`)
  }

  if (useCase.id && useCase.id !== "all") {
    filters.push(`useCase:${useCase.id}`)
  }

  if (category && category !== "all") {
    filters.push(`category:${category}`)
  }

  if (section && section !== "all") {
    filters.push(`section:${section}`)
  }

  const where = filters.join(",")
  const filter = where ? { where } : {}

  const response = await fetch("https://api.veryfront.com/graphql", {
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({
      query: useCasesQuery,
      variables: {
        search,
        filter,
        first: limit,
      },
    }),
  })

  const { data } = await response.json()
  return data?.librariesComponentSearch
}

export default async function ({ req }) {
  const json = {
    query: `query PagesListQuery($first: Int, $cacheKey: String!, $filter: FilterParams) {
    pages(first: $first, cacheKey: $cacheKey, filter: $filter) {
      edges {
        cursor
        node {
          slug
          isPublished
          frontmatter
        }
      }
    }
  }`,
    variables: {
      first: 1000,
      filter: {
        sort: "name:ASC",
      },
      cacheKey: process.env.VERYFRONT_PROJECT_ID,
    },
  }

  const response = await fetch("https://api.veryfront.com/graphql", {
    method: "POST",
    headers: {
      "x-project": process.env.VERYFRONT_PROJECT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json),
  })

  if (!response.ok) {
    throw new Error("Network response was not ok")
  }

  const { data } = await response.json()

  const templates = await fetchTemplates()

  const categoriesData = await Promise.all(
    useCases
      .filter((useCase) => !useCase.isDisabled)
      .map((useCase) => fetchComponentCategories(useCase)),
  )

  const baseUrl = "https://veryfront.com/"

  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>`
  sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`

  categoriesData?.forEach((data, index) => {
    const useCase = useCases[index]

    data.edges.forEach((edge) => {
      edge.node.categories.forEach((category) => {
        category.sections.forEach((section) => {
          const href = `components/${useCase.id}/${category.name}/${section.name}`
          sitemap += `
        <url>
          <loc>${baseUrl + href}</loc>
        </url>
      `
        })
      })
    })
  })

  data?.pages?.edges?.forEach((edge) => {
    const page = edge?.node
    const currentSlug = page?.slug

    // Regex to exclude routes that have at least one [slug] pattern anywhere in them
    const isExcludedRoute = /\/[^/]*\[[^\]]+\][^/]*/.test(currentSlug)

    if (
      page?.isPublished &&
      page?.frontmatter?.isPublished !== false &&
      !page?.frontmatter?.excludeFromSitemap &&
      !isExcludedRoute
    ) {
      sitemap += `
    <url>
      <loc>${baseUrl + (page?.slug === "/" ? "" : page?.slug)}</loc>
    </url>
  `
    }
  })

  templates
    ?.filter((template) => !template.isDisabled)
    .forEach((template) => {
      sitemap += `
    <url>
      <loc>${`${baseUrl}templates/${template?.slug}`}</loc>
    </url>
  `
    })

  sitemap += `</urlset>`

  return {
    headers: {
      "Content-Type": "application/xml",
      "Content-Length": Buffer.byteLength(sitemap),
    },
    body: sitemap,
  }
}

// https://veryfront.preview.veryfront.com/api/sitemap.xml
