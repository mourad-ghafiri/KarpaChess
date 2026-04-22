/**
 * Template Method base for every OpenAI-compatible provider.
 *
 * Subclasses provide:
 *   - `id`            — unique provider id
 *   - `name`          — display label
 *   - `endpoint()`    — full URL to POST /chat/completions
 *   - `extraHeaders()` — optional, e.g. OpenRouter's HTTP-Referer/X-Title
 *   - `hasUrl`        — override true if URL is configurable (prefixes endpoint)
 *
 * The base owns the HTTP flow, payload shape, and response shape.
 */
import { AIProvider } from './base.js';

export class OpenAICompatibleProvider extends AIProvider {
  /** Full URL for the chat-completions endpoint. Subclass must override. */
  endpoint() { throw new Error('subclass must implement endpoint'); }

  /** Extra headers per provider (e.g. OpenRouter attribution). Default: none. */
  extraHeaders() { return {}; }

  async ask(question, ctx) {
    const key = this.getKey();
    if (this.needsKey && !key) throw new Error(`${this.name} API key missing. Add it in Settings.`);

    const body = {
      model: this.getModel(),
      max_tokens: 700,
      messages: this._messages(ctx, question)
    };
    const headers = {
      'content-type': 'application/json',
      ...(key ? { 'authorization': `Bearer ${key}` } : {}),
      ...this.extraHeaders()
    };
    const res = await fetch(this.endpoint(), { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${this.name} ${res.status}: ${t.slice(0, 180)}`);
    }
    const j = await res.json();
    return (j.choices?.[0]?.message?.content || '').trim();
  }
}
