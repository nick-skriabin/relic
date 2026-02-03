/**
 * Environment variable abstraction that works in Node and Edge runtimes
 */

/**
 * Get an environment variable value
 * Works in Node.js (process.env) and Edge runtimes where process.env may exist
 */
export function getEnv(name: string): string | undefined {
  // Try globalThis.process.env first (works in Node and some Edge runtimes)
  const proc = (globalThis as { process?: { env?: Record<string, string> } })
    .process;
  if (proc?.env) {
    return proc.env[name];
  }
  return undefined;
}
