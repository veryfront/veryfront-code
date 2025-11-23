export function generateTailwindConfig(): string {
  return `
    tailwind.config = {
      darkMode: ['class', '[data-theme="dark"]'],
      theme: {
        extend: {
          colors: {
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            muted: {
              DEFAULT: 'hsl(var(--muted))',
              foreground: 'hsl(var(--muted-foreground))',
            },
            primary: {
              DEFAULT: 'hsl(var(--primary))',
              foreground: 'hsl(var(--primary-foreground))',
            },
            secondary: {
              DEFAULT: 'hsl(var(--secondary))',
              foreground: 'hsl(var(--secondary-foreground))',
            },
            highlight: {
              DEFAULT: 'hsl(var(--highlight))',
              foreground: 'hsl(var(--highlight-foreground))',
            },
            card: {
              DEFAULT: 'hsl(var(--card))',
              foreground: 'hsl(var(--card-foreground))',
            },
            panel: {
              DEFAULT: 'hsl(var(--panel))',
              foreground: 'hsl(var(--panel-foreground))',
            },
            popover: {
              DEFAULT: 'hsl(var(--popover))',
              foreground: 'hsl(var(--popover-foreground))',
            },
            destructive: {
              DEFAULT: 'hsl(var(--destructive))',
              foreground: 'hsl(var(--destructive-foreground))',
            },
            border: 'hsl(var(--border))',
            divider: 'hsl(var(--divider))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            success: 'hsl(var(--success))',
          },
          borderRadius: {
            DEFAULT: 'var(--radius)',
            sm: 'calc(var(--radius) - 4px)',
            md: 'calc(var(--radius) - 2px)',
            lg: 'calc(var(--radius) + 2px)',
            xl: 'calc(var(--radius) + 4px)',
          },
        },
      }
    }

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (window.tailwind && window.tailwind.refresh) {
          window.tailwind.refresh();
        }
      });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
          });
        });
      } else {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class']
        });
      }
    }
  `;
}
