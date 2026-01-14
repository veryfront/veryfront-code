
export default async function ({ req }) {
  const content = `
Sitemap: https://veryfront.com/api/sitemap.xml

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: YandexBot
Allow: /

User-agent: Baiduspider
Allow: /

User-agent: Bleriot
Allow: /

User-agent: AhrefsSiteAudit
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: GPTBot
Allow: /

User-agent: *
Disallow: /
`.trim()

  return {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(content),
    },
    body: content,
  }
}

// https://veryfront-2-0.preview.veryfront.com/api/robotstxt
