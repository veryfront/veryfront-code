
import { assertEquals, assertExists } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { describe, it, beforeEach } from '@std/testing/bdd.ts';
import {
  discoverAll,
  toolRegistry,
  resourceRegistry,
  promptRegistry,
} from '../../../src/ai/index.ts';

describe('Auto-Discovery Integration', () => {
  beforeEach(() => {
    toolRegistry.clear();
    resourceRegistry.clear();
    promptRegistry.clear();
  });

  it('should discover tools from ai/tools/ directory', async () => {
    const result = await discoverAll({
      baseDir: new URL('../../../examples/ai-autodiscovery/', import.meta.url).pathname,
      verbose: false,
    });

    assertEquals(result.tools.size >= 2, true);
    assertExists(result.tools.get('greet') || result.tools.get('searchWeb'));
  });

  it('should discover resources from ai/resources/ directory', async () => {
    const result = await discoverAll({
      baseDir: new URL('../../../examples/ai-autodiscovery/', import.meta.url).pathname,
      verbose: false,
    });

    assertEquals(result.resources.size >= 1, true);
  });

  it('should discover prompts from ai/prompts/ directory', async () => {
    const result = await discoverAll({
      baseDir: new URL('../../../examples/ai-autodiscovery/', import.meta.url).pathname,
      verbose: false,
    });

    assertEquals(result.prompts.size >= 1, true);
  });

  it('should register discovered tools in registry', async () => {
    await discoverAll({
      baseDir: new URL('../../../examples/ai-autodiscovery/', import.meta.url).pathname,
      verbose: false,
    });

    const toolIds = toolRegistry.getAllIds();
    assertEquals(toolIds.length >= 2, true);
  });

  it('should handle discovery errors gracefully', async () => {
    const result = await discoverAll({
      baseDir: '/nonexistent/path',
      verbose: false,
    });

    assertExists(result);
    assertExists(result.errors);
  });
});
