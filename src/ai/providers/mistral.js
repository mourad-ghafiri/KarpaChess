import { OpenAICompatibleProvider } from './openai-compat.js';

export class MistralProvider extends OpenAICompatibleProvider {
  get id() { return 'mistral'; }
  get name() { return 'Mistral AI'; }
  endpoint() { return 'https://api.mistral.ai/v1/chat/completions'; }
}
