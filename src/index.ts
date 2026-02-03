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
export {
  encryptPayload,
  decryptPayload,
  decryptAndParse,
  encryptValue,
  decryptValue,
  encryptSecrets,
  decryptSecrets,
  isEncryptedValue,
} from "./crypto.ts";
export { RelicError, ErrorCodes } from "./errors.ts";
export type {
  RelicOptions,
  RelicInstance,
  SecretsData,
} from "./types.ts";
export { Defaults, ENCRYPTED_VALUE_PREFIX } from "./types.ts";
