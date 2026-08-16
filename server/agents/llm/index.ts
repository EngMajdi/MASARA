import { LLMProvider } from './LLMProvider';
import { MockProvider } from './MockProvider';
import { GeminiProvider } from './GeminiProvider';

// AI_MODE defaults to 'mock' — MASARA must run with zero API keys (spec §12/§34).
export function getLLMProvider(): LLMProvider {
  const mode = (process.env.AI_MODE || 'mock').toLowerCase();
  if (mode === 'gemini') return new GeminiProvider();
  return new MockProvider();
}

export * from './LLMProvider';
export * from './recommendationSchema';
export { MockProvider } from './MockProvider';
export { GeminiProvider } from './GeminiProvider';
