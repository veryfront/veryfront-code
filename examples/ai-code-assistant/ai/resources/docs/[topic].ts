/**
 * Documentation Resource
 *
 * Provides access to project documentation by topic.
 */

import { resource } from 'veryfront/ai';
import { z } from 'zod';

export default resource({
  pattern: '/docs/:topic',
  description: 'Get documentation for a specific topic (e.g., agents, tools, streaming, middleware)',

  paramsSchema: z.object({
    topic: z.string(),
  }),

  load: async ({ topic }) => {
    // Simulate documentation lookup
    const docs = {
      agents: {
        title: 'Working with Agents',
        content: `# Agents in Veryfront

Agents are the core building blocks of AI applications.

## Creating an Agent

\`\`\`typescript
import { agent } from 'veryfront/ai';

const myAgent = agent({
  id: 'assistant',
  model: 'openai/gpt-4o',
  system: 'You are a helpful assistant',
  tools: {
    searchCode: true,
  },
});
\`\`\`

## Using Streaming

\`\`\`typescript
const stream = await myAgent.stream({
  input: 'Hello!',
  onChunk: (chunk) => console.log(chunk),
});
\`\`\``,
      },
      tools: {
        title: 'Creating Tools',
        content: `# Tools in Veryfront

Tools give agents capabilities to interact with external systems.

## Tool Structure

\`\`\`typescript
import { tool } from 'veryfront/ai';

export default tool({
  name: 'myTool',
  description: 'What the tool does',
  parameters: { /* JSON Schema */ },
  execute: async (params) => {
    // Tool logic
    return result;
  },
});
\`\`\``,
      },
    };

    const doc = docs[topic as keyof typeof docs];

    if (!doc) {
      return {
        success: false,
        error: `Documentation not found for topic: ${topic}`,
        availableTopics: Object.keys(docs),
      };
    }

    return {
      success: true,
      topic,
      title: doc.title,
      content: doc.content,
    };
  },
});
