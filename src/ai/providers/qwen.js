import { OpenAICompatibleProvider } from './openai-compat.js';

export class QwenProvider extends OpenAICompatibleProvider {
  get id() { return 'qwen'; }
  get name() { return 'Qwen (Alibaba)'; }
  get hasUrl() { return true; }

  endpoint() {
    const base = (this.getUrl() || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
    return `${base}/chat/completions`;
  }
}
