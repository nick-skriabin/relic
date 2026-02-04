import { createContext, createElement, useContext, type ReactNode } from "react";
import type { SecretsData } from "../types.ts";

const RelicContext = createContext<SecretsData | null>(null);

export interface RelicProviderProps {
  secrets: SecretsData;
  children?: ReactNode;
}

export function RelicProvider({ secrets, children }: RelicProviderProps) {
  return createElement(RelicContext.Provider, { value: secrets }, children);
}

export function useRelic(): SecretsData;
export function useRelic(key: string): unknown;
export function useRelic(key?: string): SecretsData | unknown {
  const secrets = useContext(RelicContext);

  if (secrets === null) {
    throw new Error("useRelic must be used within a <RelicProvider>");
  }

  if (key !== undefined) {
    if (!(key in secrets)) {
      throw new Error(`Secret key "${key}" not found in RelicProvider`);
    }
    return secrets[key];
  }

  return secrets;
}
