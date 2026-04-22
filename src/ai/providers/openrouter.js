import { OpenAICompatibleProvider } from './openai-compat.js';

export class OpenRouterProvider extends OpenAICompatibleProvider {
  get id() { return 'openrouter'; }
  get name() { return 'OpenRouter'; }
  endpoint() { return 'https://openrouter.ai/api/v1/chat/completions'; }

  // OpenRouter asks for these headers for attribution / rate limiting.
  extraHeaders() {
    return {
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://karpachess.app',
      'X-Title': 'KarpaChess'
    };
  }
}
