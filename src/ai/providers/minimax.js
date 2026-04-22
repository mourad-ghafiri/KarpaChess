import { OpenAICompatibleProvider } from './openai-compat.js';

/** MiniMax uses a slightly different v2 path but the payload is OpenAI-shaped. */
export class MiniMaxProvider extends OpenAICompatibleProvider {
  get id() { return 'minimax'; }
  get name() { return 'MiniMax'; }
  get hasUrl() { return true; }

  endpoint() {
    const base = (this.getUrl() || 'https://api.minimaxi.chat/v1').replace(/\/$/, '');
    return `${base}/text/chatcompletion_v2`;
  }
}
