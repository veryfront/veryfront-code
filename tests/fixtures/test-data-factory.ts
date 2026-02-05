export class TestDataFactory {
  static createMDXPage(options: {
    title: string;
    content: string;
    frontmatter?: Record<string, any>;
  }): string {
    const frontmatter = options.frontmatter;

    if (!frontmatter || Object.keys(frontmatter).length === 0) {
      return `# ${options.title}\n\n${options.content}`;
    }

    const frontmatterLines = Object.entries(frontmatter).map(([key, value]) => {
      if (typeof value === "string") return `${key}: ${value}`;
      if (Array.isArray(value)) return `${key}: [${value.join(", ")}]`;
      return `${key}: ${JSON.stringify(value)}`;
    });

    return `---\n${frontmatterLines.join("\n")}\n---\n\n# ${options.title}\n\n${options.content}`;
  }

  static createReactComponent(name: string, props: string[] = []): string {
    const hasProps = props.length > 0;

    const propsInterface = hasProps
      ? `interface ${name}Props {
${props.map((p) => `  ${p}: any;`).join("\n")}
}`
      : "";

    const propsParam = hasProps ? `{ ${props.join(", ")} }: ${name}Props` : "()";
    const propsSpans = hasProps
      ? `\n      ${props.map((p) => `<span>{${p}}</span>`).join("\n      ")}`
      : "";

    return `import React from 'react';

${propsInterface}

export default function ${name}${propsParam} {
  return (
    <div data-testid="${name.toLowerCase()}" className="${name.toLowerCase()}">
      ${name} Component${propsSpans}
    </div>
  );
}

export { ${name} };`;
  }

  static createAppLayout(options: { title?: string; includeMetadata?: boolean } = {}): string {
    const title = options.title ?? "Test App";

    const metadata = options.includeMetadata
      ? `
export const metadata = {
  title: '${title}',
  description: 'Test application'
};
`
      : "";

    return `${metadata}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>${title}</title>
      </head>
      <body>
        <div id="app">
          {children}
        </div>
      </body>
    </html>
  );
}`;
  }

  static createAPIHandler(options: { methods?: string[]; useContext?: boolean } = {}): string {
    const methods = options.methods ?? ["GET"];

    return methods
      .map((method) => {
        const hasBody = ["POST", "PUT", "PATCH"].includes(method);
        const contextParam = options.useContext ? ", context: any" : "";
        const bodyParsing = hasBody ? "\n    const body = await request.json();" : "";
        const bodyField = hasBody ? "\n    body," : "";
        const contextField = options.useContext ? "\n    context," : "";

        return `export async function ${method}(request: Request${contextParam}) {${bodyParsing}
  
  return Response.json({
    method: '${method}',
    timestamp: new Date().toISOString(),${bodyField}${contextField}
  });
}`;
      })
      .join("\n\n");
  }

  static createCustomHook(name: string, returnValue: any = { value: 0 }): string {
    return `import { useState, useEffect } from 'react';

export function ${name}() {
  const [state, setState] = useState(${JSON.stringify(returnValue)});
  
  useEffect(() => {
    // Simulate async operation
    const timer = setTimeout(() => {
      setState(prev => ({ ...prev, loaded: true }));
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);
  
  return state;
}`;
  }

  static createCSSModule(className: string): string {
    return `.${className} {
  display: flex;
  flex-direction: column;
  padding: 1rem;
  margin: 0;
  background-color: #f0f0f0;
}

.${className}__title {
  font-size: 2rem;
  font-weight: bold;
  color: #333;
}

.${className}__content {
  margin-top: 1rem;
  line-height: 1.6;
}

@media (max-width: 768px) {
  .${className} {
    padding: 0.5rem;
  }
  
  .${className}__title {
    font-size: 1.5rem;
  }
}`;
  }

  static createConfig(
    options: {
      title?: string;
      port?: number;
      security?: Record<string, any>;
      features?: string[];
    } = {},
  ): string {
    const config: any = {
      title: options.title ?? "Test Site",
      description: "Test site for automated testing",
      cache: {
        dir: ".veryfront/cache",
        render: {
          type: "memory",
          ttl: 60_000,
          maxEntries: 200,
        },
      },
    };

    if (options.port) {
      config.dev = { port: options.port };
    }

    if (options.security) {
      config.security = options.security;
    }

    if (options.features?.length) {
      config.experimental = Object.fromEntries(options.features.map((feature) => [feature, true]));
    }

    return `export default ${JSON.stringify(config, null, 2)};`;
  }

  static createMiddleware(name: string): string {
    return `export async function ${name}(request: Request, next: () => Promise<Response>) {
  const start = Date.now();
  
  // Add custom header
  request.headers.set('X-${name}-Start', start.toString());
  
  // Call next middleware
  const response = await next();
  
  // Add timing header
  response.headers.set('X-${name}-Duration', (Date.now() - start).toString());
  
  return response;
}`;
  }

  static createUser(
    overrides: Partial<{
      id: string;
      name: string;
      email: string;
      role: string;
    }> = {},
  ): any {
    return {
      id: crypto.randomUUID(),
      name: "Test User",
      email: "test@example.com",
      role: "user",
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  static createRedisResponse<T>(
    value: T,
    ttl?: number,
  ): {
    value: T;
    ttl: number;
    type: string;
  } {
    return {
      value,
      ttl: ttl ?? -1,
      type: typeof value,
    };
  }

  static createMockResponse(
    options: { status?: number; body?: any; headers?: Record<string, string> } = {},
  ): Response {
    const status = options.status ?? 200;
    const headers = new Headers(options.headers ?? {});
    const hasBody = options.body !== undefined && options.body !== null;

    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    return new Response(hasBody ? JSON.stringify(options.body) : null, { status, headers });
  }
}
