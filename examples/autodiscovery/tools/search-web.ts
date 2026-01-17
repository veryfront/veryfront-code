/**
 * Example tool: Web search (mock)
 * Will be auto-discovered and registered as "searchWeb"
 */

import { tool } from 'veryfront/tool';
import { z } from 'zod';

export default tool({
  description: 'Search the web for information',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().default(10).describe('Maximum number of results'),
  }),
  execute: async ({ query, maxResults }) => {
    // Mock search results
    return {
      query,
      results: [
        {
          title: `Result 1 for "${query}"`,
          url: 'https://example.com/1',
          snippet: 'This is a mock search result',
        },
        {
          title: `Result 2 for "${query}"`,
          url: 'https://example.com/2',
          snippet: 'Another mock search result',
        },
      ].slice(0, maxResults),
    };
  },
});
