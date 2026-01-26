import { isRscExperimentalEnabled } from "../config/env.js";
export function isRSCEnabled(config, env) {
    return config?.experimental?.rsc ?? isRscExperimentalEnabled(env);
}
