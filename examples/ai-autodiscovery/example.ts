/**
 * Auto-Discovery Example
 *
 * Demonstrates:
 * - Automatic discovery of tools, agents, resources, prompts
 * - File-system based registration
 * - MCP server creation
 */

import {
  discoverAll,
  getMCPStats,
  createMCPServer,
} from '../../src/ai/index.ts';

console.log('=== Veryfront AI Auto-Discovery ===\n');

// ============================================================================
// 1. Discover all AI components
// ============================================================================

console.log('Discovering AI components...');

const result = await discoverAll({
  baseDir: new URL('.', import.meta.url).pathname,
  aiDir: 'ai',
  verbose: true,
});

console.log('\n=== Discovery Results ===');
console.log(`Tools discovered: ${result.tools.size}`);
console.log(`Agents discovered: ${result.agents.size}`);
console.log(`Resources discovered: ${result.resources.size}`);
console.log(`Prompts discovered: ${result.prompts.size}`);

if (result.errors.length > 0) {
  console.log(`\nErrors: ${result.errors.length}`);
  result.errors.forEach((e) => {
    console.log(`  - ${e.file}: ${e.error.message}`);
  });
}

// ============================================================================
// 2. Show discovered tools
// ============================================================================

console.log('\n=== Discovered Tools ===');
for (const [id, tool] of result.tools.entries()) {
  console.log(`  ${id}:`);
  console.log(`    Description: ${tool.description}`);
}

// ============================================================================
// 3. Show discovered resources
// ============================================================================

console.log('\n=== Discovered Resources ===');
for (const [id, resource] of result.resources.entries()) {
  console.log(`  ${id}:`);
  console.log(`    Pattern: ${resource.pattern}`);
  console.log(`    Description: ${resource.description}`);
}

// ============================================================================
// 4. Show discovered prompts
// ============================================================================

console.log('\n=== Discovered Prompts ===');
for (const [id, promptInstance] of result.prompts.entries()) {
  console.log(`  ${id}:`);
  console.log(`    Description: ${promptInstance.description}`);

  // Get prompt content with sample variables
  const content = await promptInstance.getContent({
    customerName: 'John Doe',
    issueType: 'billing',
  });
  console.log(`    Content preview: ${content.substring(0, 100)}...`);
}

// ============================================================================
// 5. Show MCP registry stats
// ============================================================================

const stats = getMCPStats();
console.log('\n=== MCP Registry Stats ===');
console.log(`  Tools: ${stats.tools}`);
console.log(`  Resources: ${stats.resources}`);
console.log(`  Prompts: ${stats.prompts}`);
console.log(`  Total: ${stats.total}`);

// ============================================================================
// 6. Create MCP Server
// ============================================================================

console.log('\n=== MCP Server ===');

const mcpServer = createMCPServer({
  enabled: true,
  port: 3001,
  auth: {
    type: 'none', // No auth for this example
  },
  cors: {
    enabled: true,
  },
});

console.log('MCP Server created');
console.log('  Port: 3001');
console.log('  Auth: none');
console.log('  CORS: enabled');

// ============================================================================
// 7. Test MCP Server Methods
// ============================================================================

console.log('\n=== Testing MCP Server Methods ===');

// Test tools/list
const toolsResponse = await mcpServer.handleRequest({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
});

console.log('\ntools/list response:');
console.log(`  Tools: ${toolsResponse.result?.tools?.length || 0}`);

// Test resources/list
const resourcesResponse = await mcpServer.handleRequest({
  jsonrpc: '2.0',
  id: 2,
  method: 'resources/list',
});

console.log('\nresources/list response:');
console.log(`  Resources: ${resourcesResponse.result?.resources?.length || 0}`);

// Test prompts/list
const promptsResponse = await mcpServer.handleRequest({
  jsonrpc: '2.0',
  id: 3,
  method: 'prompts/list',
});

console.log('\nprompts/list response:');
console.log(`  Prompts: ${promptsResponse.result?.prompts?.length || 0}`);

// Test tool call
console.log('\n=== Testing Tool Execution ===');

const greetResponse = await mcpServer.handleRequest({
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: {
    name: 'greet',
    arguments: { name: 'Alice' },
  },
});

console.log('\nTool call (greet) response:');
console.log(`  Success: ${!greetResponse.error}`);
if (greetResponse.result) {
  console.log(`  Result: ${greetResponse.result.content[0].text}`);
}

console.log('\n=== Auto-Discovery Complete ===');
