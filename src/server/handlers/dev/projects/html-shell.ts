import { DEV_UI_KIND_ATTRIBUTE } from "#veryfront/extensions/dev-ui/protocol";

export const PROJECTS_SHELL_HTML = `<!DOCTYPE html>
<html lang="en" ${DEV_UI_KIND_ATTRIBUTE}="projects">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veryfront - Projects</title>
</head>
<body class="bg-vf-bg min-h-screen antialiased text-vf-text">
  <div id="root"></div>
  <script type="module" src="/_projects/ui/index.js"></script>
</body>
</html>`;
