/**
 * Universal base64 utilities that work in both Node and Edge runtimes
 */

/**
 * Encode a Uint8Array to base64 string
 */
export function encodeBase64(data: Uint8Array): string {
  // Check if Buffer is available (Node.js)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  // Fallback for Edge/Browser using btoa
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to Uint8Array
 */
export function decodeBase64(base64: string): Uint8Array {
  // Check if Buffer is available (Node.js)
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  // Fallback for Edge/Browser using atob
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
