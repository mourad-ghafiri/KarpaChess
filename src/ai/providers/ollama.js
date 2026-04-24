/** Ollama — local server, slightly different API (/api/chat, no auth, no `messages.choices`). */
import { AIProvider, coachSystemPrompt, buildContextBlock } from './base.js';

export class OllamaProvider extends AIProvider {
  get id() { return 'ollama'; }
  get name() { return 'Ollama (local)'; }
  get needsKey() { return false; }
  get hasUrl() { return true; }

  async ask(question, ctx) {
    const base = (this.getUrl() || 'http://localhost:11434').replace(/\/$/, '');
    const body = {
      model: this.getModel(),
      stream: false,
      messages: [
        { role: 'system', content: coachSystemPrompt() },
        { role: 'user',   content: `Position:\n${buildContextBlock(ctx)}\n\nQuestion: ${question}` }
      ]
    };
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${this.name} ${res.status}: ${t.slice(0, 180)}`);
    }
    const j = await res.json();
    return (j.message?.content || '').trim();
  }
}
