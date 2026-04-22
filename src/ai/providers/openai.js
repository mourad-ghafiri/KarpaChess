import { OpenAICompatibleProvider } from './openai-compat.js';

export class OpenAIProvider extends OpenAICompatibleProvider {
  get id() { return 'openai'; }
  get name() { return 'OpenAI · GPT'; }
  endpoint() { return 'https://api.openai.com/v1/chat/completions'; }
}
