import { OpenAICompatibleProvider } from './openai-compat.js';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  get id() { return 'deepseek'; }
  get name() { return 'DeepSeek'; }
  endpoint() { return 'https://api.deepseek.com/v1/chat/completions'; }
}
