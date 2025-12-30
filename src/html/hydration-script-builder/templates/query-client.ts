export const getQueryClientScript = () => `
    // Create a QueryClient for react-query
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,
          retry: 1,
        },
      },
    });

    const QueryClientProviderWrapper = ({ children }) => {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    };
`;
