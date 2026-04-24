/**
 * Loads the lessons/ and puzzles/ manifests + every referenced file in parallel.
 * Content is language-scoped: lesson/puzzle JSON bodies live under
 * `data/lessons/<lang>/...` and `data/puzzles/<lang>/...`. The two `index.json`
 * files at the root stay language-agnostic — they only list ids + filenames.
 *
 * If a localized file is missing or malformed, we fall back to the English
 * source for that one file. This lets partial translations ship without
 * breaking the lesson/puzzle list.
 */
export class ContentLoader {
  constructor() {
    this.lessons = null;
    this.puzzles = null;
    this.lang = 'en';
  }

  async loadAll(lang) {
    this.lang = lang || 'en';
    const [lessons, puzzles] = await Promise.all([this.#loadLessons(), this.#loadPuzzles()]);
    this.lessons = lessons;
    this.puzzles = puzzles;
    return { lessons, puzzles };
  }

  async #loadJson(path) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetch the localized version, falling back to English on miss.
   * Index files at the data root are language-agnostic.
   */
  async #loadLocalized(category, file) {
    const localized = await this.#loadJson(`data/${category}/${this.lang}/${file}`);
    if (localized) return localized;
    if (this.lang === 'en') return null;
    return await this.#loadJson(`data/${category}/en/${file}`);
  }

  async #loadLessons() {
    const index = await this.#loadJson('data/lessons/index.json');
    if (!index) return null;
    const out = { version: index.version || 1, categories: [] };
    for (const cat of index.categories || []) {
      const files = cat.lessons || [];
      const lessons = await Promise.all(files.map(f => this.#loadLocalized('lessons', f)));
      const clean = lessons.filter(l => l && l.id && Array.isArray(l.steps));
      out.categories.push({
        id: cat.id,
        icon: cat.icon,
        lessons: clean
      });
    }
    return out;
  }

  async #loadPuzzles() {
    const index = await this.#loadJson('data/puzzles/index.json');
    if (!index) return null;
    const out = { version: index.version || 1, themes: [] };
    for (const th of index.themes || []) {
      const files = th.puzzles || [];
      const puzzles = await Promise.all(files.map(f => this.#loadLocalized('puzzles', f)));
      const clean = puzzles.filter(p => p && p.fen && Array.isArray(p.solution));
      out.themes.push({
        id: th.id,
        icon: th.icon,
        difficulty: th.difficulty,
        puzzles: clean
      });
    }
    return out;
  }
}
