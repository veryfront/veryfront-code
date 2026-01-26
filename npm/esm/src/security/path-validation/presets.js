export const ValidationPresets = {
    userInput(baseDir) {
        return {
            baseDir,
            level: "strict",
            allowedDirs: [
                "app",
                "pages",
                "public",
                "components",
                "lib",
                "src",
                "utils",
                "helpers",
                "hooks",
                "services",
                "styles",
                "assets",
                "constants",
                "types",
                "api",
            ],
            followSymlinks: false,
            checkExists: true,
            allowAbsolute: false,
        };
    },
    internal(baseDir) {
        return {
            baseDir,
            level: "normal",
            followSymlinks: false,
            checkExists: false,
            allowAbsolute: false,
        };
    },
    build(baseDir) {
        return {
            baseDir,
            level: "permissive",
            followSymlinks: true,
            checkExists: false,
            allowAbsolute: true,
        };
    },
    static(baseDir) {
        return {
            baseDir,
            level: "normal",
            allowedDirs: ["dist", "public"],
            followSymlinks: false,
            checkExists: true,
            allowAbsolute: false,
        };
    },
};
