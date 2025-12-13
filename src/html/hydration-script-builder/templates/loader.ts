export const getLoaderScript = () => `
    async function loadComponent(path) {
      if (!path) return null;
      try {
        const match = path.match(/\\/(pages|components|app|lib)\\/(.+)\\.(tsx|ts|jsx)$/);
        if (!match) {
          console.error('[Veryfront] Invalid component path:', path);
          return null;
        }
        const relativePath = \`\${MODULE_SERVER_URL}/\${match[1]}/\${match[2]}.js\`;
        const module = await import(relativePath);
        return module.default || module;
      } catch (error) {
        console.error('[Veryfront] Failed to load component:', path, error);
        return null;
      }
    }
`;
