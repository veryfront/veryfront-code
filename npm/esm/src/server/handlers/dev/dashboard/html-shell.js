export const DASHBOARD_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veryfront Dev</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
            mono: ['SF Mono', 'Monaco', 'Consolas', 'monospace'],
          },
        },
      },
    };
  </script>
  <style>
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 0.6s linear infinite; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@18.3.1",
        "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
        "react-dom/client": "https://esm.sh/react-dom@18.3.1/client"
      }
    }
  </script>
  <script type="module" src="/_dev/ui/index.js"></script>
</body>
</html>`;
