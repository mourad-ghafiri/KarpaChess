/** LM Studio — local OpenAI-compatible server. Default port 1234, no auth. */
import { AIProvider, COACH_SYSTEM, buildContextBlock } from './base.js';

export class LMStudioProvider extends AIProvider {
  get id() { return 'lmstudio'; }
  get name() { return 'LM Studio (local)'; }
  get needsKey() { return false; }
  get hasUrl() { return true; }

  async ask(question, ctx) {
    const model = this.getModel();
    if (!model) {
      throw new Error(`LM Studio model missing. Pick one in Settings or type the exact model ID from LM Studio's server tab.`);
    }
    const base = (this.getUrl() || 'http://localhost:1234/v1').replace(/\/$/, '');
    // LM Studio has no auth by default, but some builds still expect a bearer
    // header; pass a benign one so the request never 401s in that case.
    const apiKey = this.getKey() || 'lm-studio';
    const body = {
      model,
      max_tokens: 700,
      messages: this._messages(ctx, question)
    };
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${this.name} ${res.status}: ${t.slice(0, 180)}`);
    }
    const j = await res.json();
    return (j.choices?.[0]?.message?.content || '').trim();
  }
}
