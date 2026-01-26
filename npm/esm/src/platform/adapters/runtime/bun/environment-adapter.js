import process from "node:process";
export class BunEnvironmentAdapter {
    get(key) {
        return process.env[key];
    }
    set(key, value) {
        process.env[key] = value;
    }
    toObject() {
        const result = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined)
                result[key] = value;
        }
        return result;
    }
}
