/** Anthropic Claude — different payload shape (system at top level, content array). */
import { AIProvider, coachSystemPrompt, buildContextBlock } from './base.js';

export class AnthropicProvider extends AIProvider {
  get id() { return 'anthropic'; }
  get name() { return 'Anthropic · Claude'; }

  async ask(question, ctx) {
    const key = this.getKey();
    if (!key) throw new Error(`${this.name} API key missing. Add it in Settings.`);

    const body = {
      model: this.getModel(),
      max_tokens: 700,
      system: coachSystemPrompt(),
      messages: [{ role: 'user', content: `Position:\n${buildContextBlock(ctx)}\n\nQuestion: ${question}` }]
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${this.name} ${res.status}: ${t.slice(0, 180)}`);
    }
    const j = await res.json();
    return (j.content || []).map(b => b.text || '').join('\n').trim();
  }
}
