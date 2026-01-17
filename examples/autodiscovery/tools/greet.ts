/**
 * Example tool: Greet user
 * Will be auto-discovered and registered as "greet"
 */

import { tool } from 'veryfront/tool';
import { z } from 'zod';

export default tool({
  description: 'Greet a user by name',
  inputSchema: z.object({
    name: z.string().describe('The name of the person to greet'),
  }),
  execute: async ({ name }) => {
    return {
      greeting: `Hello, ${name}! Welcome to Veryfront AI.`,
      timestamp: new Date().toISOString(),
    };
  },
});
