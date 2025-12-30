export const getLoaderScript = () => `
    async function loadComponent(path) {
      if (!path) return null;
      try {
        // Try absolute path format first (legacy): /project/dir/pages/foo.tsx
        let match = path.match(/\\/(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/);

        // Try project-relative path format: pages/foo.mdx or layouts/DefaultLayout.mdx
        if (!match) {
          match = path.match(/^(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/);
        }

        if (!match) {
          console.error('[Veryfront] Invalid component path:', path);
          return null;
        }
        const relativePath = \`\${MODULE_SERVER_URL}/\${match[1]}/\${match[2]}.js\`;
        console.log('[Veryfront] Loading component:', relativePath);
        const module = await import(relativePath);
        return module.default || module;
      } catch (error) {
        console.error('[Veryfront] Failed to load component:', path, error);
        return null;
      }
    }
`;
