export default {
  title: "Veryfront RSC Demo",
  dev: {
    port: 3002,
    open: false,
  },
  resolve: {
    importMap: {
      imports: {
        "react": "https://esm.sh/react@19.1.1",
        "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
        "react/jsx-dev-runtime": "https://esm.sh/react@19.1.1/jsx-dev-runtime",
        "react-dom": "https://esm.sh/react-dom@19.1.1",
        "react-dom/client": "https://esm.sh/react-dom@19.1.1/client",
        "react-dom/server": "https://esm.sh/react-dom@19.1.1/server",
      },
    },
  },
  generate: {
    preferredRouter: "app-router",
  },
};
