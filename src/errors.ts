/**
 * Error codes for Relic operations
 */
export const ErrorCodes = {
  MISSING_ARTIFACT: "RELIC_ERR_MISSING_ARTIFACT",
  MISSING_MASTER_KEY: "RELIC_ERR_MISSING_MASTER_KEY",
  DECRYPT_FAILED: "RELIC_ERR_DECRYPT_FAILED",
  INVALID_JSON: "RELIC_ERR_INVALID_JSON",
  UNSUPPORTED_VERSION: "RELIC_ERR_UNSUPPORTED_VERSION",
  KEY_NOT_FOUND: "RELIC_ERR_KEY_NOT_FOUND",
  INVALID_ARTIFACT_FORMAT: "RELIC_ERR_INVALID_ARTIFACT_FORMAT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Custom error class for Relic errors
 */
export class RelicError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "RelicError";
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RelicError);
    }
  }
}

/**
 * Helper functions to create specific errors
 */
export function missingArtifactError(): RelicError {
  return new RelicError(
    ErrorCodes.MISSING_ARTIFACT,
    "Artifact not provided and not found in environment variable"
  );
}

export function missingMasterKeyError(): RelicError {
  return new RelicError(
    ErrorCodes.MISSING_MASTER_KEY,
    "Master key not provided and not found in environment variable"
  );
}

export function decryptFailedError(): RelicError {
  return new RelicError(
    ErrorCodes.DECRYPT_FAILED,
    "Failed to decrypt artifact - wrong key or corrupted data"
  );
}

export function invalidJsonError(): RelicError {
  return new RelicError(
    ErrorCodes.INVALID_JSON,
    "Decrypted artifact is not valid JSON"
  );
}

export function unsupportedVersionError(version: number): RelicError {
  return new RelicError(
    ErrorCodes.UNSUPPORTED_VERSION,
    `Unsupported artifact version: ${version}`
  );
}

export function keyNotFoundError(key: string): RelicError {
  return new RelicError(ErrorCodes.KEY_NOT_FOUND, `Key not found: ${key}`);
}

export function invalidArtifactFormatError(): RelicError {
  return new RelicError(
    ErrorCodes.INVALID_ARTIFACT_FORMAT,
    "Invalid artifact format - expected JSON envelope"
  );
}
