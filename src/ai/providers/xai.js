import { OpenAICompatibleProvider } from './openai-compat.js';

export class XAIProvider extends OpenAICompatibleProvider {
  get id() { return 'xai'; }
  get name() { return 'xAI · Grok'; }
  endpoint() { return 'https://api.x.ai/v1/chat/completions'; }
}
