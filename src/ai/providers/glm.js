import { OpenAICompatibleProvider } from './openai-compat.js';

export class GLMProvider extends OpenAICompatibleProvider {
  get id() { return 'glm'; }
  get name() { return 'GLM (Zhipu)'; }
  get hasUrl() { return true; }

  endpoint() {
    const base = (this.getUrl() || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
    return `${base}/chat/completions`;
  }
}
