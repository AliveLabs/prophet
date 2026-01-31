import { dataForSeoProvider } from "./dataforseo"
import { geminiProvider } from "./gemini"
import type { Provider } from "./types"

const providers: Record<string, Provider> = {
  dataforseo: dataForSeoProvider,
  gemini: geminiProvider,
}

export function getProvider(name: string): Provider {
  const provider = providers[name]
  if (!provider) {
    throw new Error(`Unsupported provider: ${name}`)
  }
  return provider
}
