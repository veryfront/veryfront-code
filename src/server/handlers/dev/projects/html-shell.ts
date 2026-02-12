export const PROJECTS_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veryfront - Projects</title>
  <link rel="icon" type="image/png" href="https://cdn.veryfront.com/images/veryfront-favicon.png"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @font-face {
      font-family: 'Gellix';
      src:
        url('https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/fonts/GellixVF.woff2') format('woff2'),
        url('https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/fonts/GellixVF.woff') format('woff');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
  </style>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Gellix', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          },
          colors: {
            'vf-bg': '#f0efea',
            'vf-card': '#ffffff',
            'vf-border': '#ddd9d0',
            'vf-text': '#1a1a1a',
            'vf-muted': '#666',
          },
        },
      },
    };
  </script>
  <style>
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #ddd9d0; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #999; }
  </style>
</head>
<body class="bg-vf-bg min-h-screen antialiased text-vf-text">
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
  <script type="module" src="/_projects/ui/index.js"></script>
</body>
</html>`;
