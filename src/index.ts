/**
 * Relic - Rails-credentials-like encrypted secrets for JS apps
 *
 * Works in both Node and Edge runtimes.
 *
 * @example
 * ```ts
 * import { createRelic } from "relic";
 *
 * const relic = createRelic();
 * const secrets = await relic.load();
 * console.log(secrets.API_KEY);
 * ```
 */

export { createRelic } from "./runtime.ts";
export { encryptPayload, decryptPayload, decryptAndParse } from "./crypto.ts";
export { RelicError, ErrorCodes } from "./errors.ts";
export type {
  RelicOptions,
  RelicInstance,
  SecretsData,
  ArtifactEnvelope,
} from "./types.ts";
export { Defaults, CURRENT_VERSION } from "./types.ts";
