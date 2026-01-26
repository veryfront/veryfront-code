export const DEFAULT_CONFIG = {
    instrumentHttp: true,
    instrumentFetch: true,
    instrumentReact: true,
    captureErrors: true,
};
export function mergeConfig(config = {}) {
    return { ...DEFAULT_CONFIG, ...config };
}
