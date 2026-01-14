import got from "https://esm.sh/got@12.6.1?target=node";

export default async function ({ req }) {
  let json = {
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
        sort: "name:ASC"
      },
      "cacheKey": process.env.VERYFRONT_PROJECT_ID
    }
  }

  const { data } = await got
    .post("https://api.veryfront.com/graphql", {
      headers: {
        'x-project': process.env.VERYFRONT_PROJECT_ID,
        'Content-Type': 'application/json',
      },
      json,
    })
    .json();

  const baseUrl = 'https://veryfront.com/';

  const channel = {
    title: "Veryfront",
    feedUrl: "https://veryfront.com/api/rss",
    language: "en",
    image: "https://cdn.codersociety.com/images/veryfront-og-image-logomark.png",
    description: "On our blog we share our take on the latest technology trends, and practical guides on new technologies and methods.",
  }

  const channelImage = channel.image
    ? `<image>
        <title>${channel.title}</title>
        <url>${channel.image}</url>
        <link>${baseUrl}</link>
      </image>`
    : ''

  const feedItems = data?.pages?.edges?.filter(({ node }) => node?.frontmatter?.rss)
  
  const channelFeed = feedItems?.map(({ node }) => {
    const link = baseUrl + (node?.slug === '/' ? '' : node?.slug)
    const meta = node?.frontmatter?.context?.meta || {}
    const title = meta.title
    const description = meta.description
    const publicationDate = meta.publicationDate
    const image = meta.image
    const creator = meta.author || channel.title
    const imageTag = image ? `<img src="${image}" alt="${title || ''}" />` : ''

    return `
      <item>
        <title><![CDATA[${title}]]></title>
        <link>${link}</link>
        <guid isPermaLink="true">${link}</guid>
        ${publicationDate ? `<pubDate>${new Date(publicationDate).toUTCString()}</pubDate>` : ''}
        <dc:creator><![CDATA[${creator}]]></dc:creator>
        ${description ? `<description><![CDATA[${description}]]></description>` : ''}
        ${ imageTag ? `<content:encoded><![CDATA[${imageTag}]]></content:encoded>` : ''}
      </item>
    `
  }).join('')

  const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
      <title>${channel.title}</title>
      <link>${baseUrl}</link>
      <atom:link href="${channel.feedUrl}" rel="self" type="application/rss+xml" />
      ${channel.description ? `<description>${channel.description}</description>` : ''}
      ${channel.updatedAt ? `<lastBuildDate>${new Date(channel.updatedAt).toUTCString()}</lastBuildDate>`: ''}
      <language>${channel.language}</language>
      ${channelImage}
      ${channelFeed}
    </channel>
  </rss>
  `

  return {
    headers: {
      'Content-Type': 'application/xml',
      'Content-Length': Buffer.byteLength(rssFeed),
    },
    body: rssFeed,
  }
}

// https://veryfront-2-0.preview.veryfront.com/api/rss
