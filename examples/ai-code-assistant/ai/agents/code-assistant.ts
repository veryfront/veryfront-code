/**
 * Code Assistant Agent
 *
 * AI agent for helping developers understand and navigate codebases.
 */

import { agent } from 'veryfront/ai';
import { promptRegistry } from 'veryfront/ai/mcp/prompt';

export default agent({
  id: 'codeAssistant',

  model: 'openai/gpt-4o',

  // Load the system prompt from the prompt registry
  system: async () => {
    const prompt = promptRegistry.get('codeAssistant');
    if (!prompt) {
      throw new Error('Code assistant prompt not found');
    }
    return await prompt.getContent();
  },

  // Reference the auto-discovered tools by their IDs
  tools: {
    searchCode: true,
    readFile: true,
    listFiles: true,
    gitStatus: true,
  },

  // Memory configuration
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },

  // Enable streaming for real-time responses
  streaming: true,

  // Maximum agent loop steps
  maxSteps: 10,
});
