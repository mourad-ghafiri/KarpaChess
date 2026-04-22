/**
 * Loads the lessons/ and puzzles/ manifests + every referenced file in parallel.
 * One bad file is logged and dropped; the rest still work.
 */
export class ContentLoader {
  constructor() {
    this.lessons = null;
    this.puzzles = null;
  }

  async loadAll() {
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
      console.warn(`Could not load ${path}: ${e.message}. If you opened index.html via file://, serve it instead (\`python3 -m http.server\`).`);
      return null;
    }
  }

  async #loadLessons() {
    const index = await this.#loadJson('data/lessons/index.json');
    if (!index) return null;
    const out = { version: index.version || 1, categories: [] };
    for (const cat of index.categories || []) {
      const files = cat.lessons || [];
      const lessons = await Promise.all(files.map(f => this.#loadJson(`data/lessons/${f}`)));
      const clean = lessons.filter(l => l && l.id && Array.isArray(l.steps));
      out.categories.push({
        id: cat.id, name: cat.name, icon: cat.icon,
        description: cat.description, lessons: clean
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
      const puzzles = await Promise.all(files.map(f => this.#loadJson(`data/puzzles/${f}`)));
      const clean = puzzles.filter(p => p && p.fen && Array.isArray(p.solution));
      out.themes.push({
        id: th.id, name: th.name, icon: th.icon,
        description: th.description, difficulty: th.difficulty,
        puzzles: clean
      });
    }
    return out;
  }
}
