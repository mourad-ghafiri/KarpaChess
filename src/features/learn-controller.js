/**
 * Learn tab controller. Renders categories → lessons → steps, handles the
 * user's move attempts in play-steps, and awards lesson completion.
 */
import * as Chess from '../engine/chess.js';
import { $ } from '../core/dom.js';
import { MODE_IDS } from '../core/constants.js';
import { normalizeSan } from '../engine/chess.js';
import { i18n } from '../core/i18n.js';

export class LearnController {
  constructor({ gameState, content, prefs, learnState, sound, toast }) {
    Object.assign(this, { gameState, content, prefs, learnState, sound, toast });

    this.backLinks();
  }

  backLinks() {
    $('#learn-back-to-cats').addEventListener('click', () => {
      this.learnState.goToCategories();
      this.gameState.setMode(MODE_IDS.PRACTICE);
      this.render();
    });
    $('#learn-back-to-lessons').addEventListener('click', () => {
      this.learnState.goToCategory(this.learnState.catId);
      this.gameState.setMode(MODE_IDS.PRACTICE);
      this.render();
    });
  }

  onEnterTab() {
    if (this.learnState.isOnSteps() && this.#currentLesson()) {
      this.gameState.setMode(MODE_IDS.LESSON);
    }
    this.render();
  }

  render() {
    $('#learn-categories').hidden = this.learnState.view !== 'categories';
    $('#learn-lessons').hidden    = this.learnState.view !== 'lessons';
    $('#learn-steps').hidden      = this.learnState.view !== 'steps';
    if (this.learnState.view === 'categories') this.#renderCategoryList();
    else if (this.learnState.view === 'lessons') this.#renderLessonList();
    else if (this.learnState.view === 'steps')   this.#renderCurrentStep();
  }

  #renderCategoryList() {
    const list = $('#category-list');
    list.innerHTML = '';
    const data = this.content.lessons;
    if (!data) {
      list.innerHTML = `<div class="review-empty">${esc(i18n.t('learn.noData'))}</div>`;
      return;
    }
    for (const cat of data.categories) {
      const doneCount = cat.lessons.filter(l => this.prefs.isLessonComplete(l.id)).length;
      const name = i18n.t(`lessons.categories.${cat.id}.name`);
      const desc = i18n.t(`lessons.categories.${cat.id}.description`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'category-card';
      btn.innerHTML = `
        <div class="cat-icon">${cat.icon || '♟'}</div>
        <div>
          <div class="cat-title">${esc(name)}</div>
          <div class="cat-desc">${esc(desc)}</div>
        </div>
        <div class="cat-count">${doneCount}/${cat.lessons.length}</div>`;
      btn.addEventListener('click', () => { this.learnState.goToCategory(cat.id); this.render(); });
      list.appendChild(btn);
    }
  }

  #renderLessonList() {
    const cat = this.#currentCategory();
    if (!cat) { this.learnState.goToCategories(); this.render(); return; }
    $('#learn-cat-title').textContent = i18n.t(`lessons.categories.${cat.id}.name`);
    $('#learn-cat-desc').textContent = i18n.t(`lessons.categories.${cat.id}.description`);
    const list = $('#learn-lesson-list');
    list.innerHTML = '';
    for (const lesson of cat.lessons) {
      const done = this.prefs.isLessonComplete(lesson.id);
      const card = document.createElement('div');
      card.className = 'lesson-card' + (done ? ' done' : '');
      card.innerHTML = `
        <div>
          <div class="lesson-title">${esc(lesson.title)}</div>
          <div class="lesson-sub">${esc(lesson.summary || '')}</div>
        </div>
        <div class="lesson-diff">${esc(lesson.difficulty || 'beginner')}</div>`;
      card.addEventListener('click', () => this.#startLesson(lesson.id));
      list.appendChild(card);
    }
  }

  #startLesson(lessonId) {
    const cat = this.#currentCategory();
    const lesson = cat.lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    this.gameState.setMode(MODE_IDS.LESSON);
    this.learnState.startLesson(cat.id, lessonId);
    this.render();
    this.#applyStep();
  }

  #applyStep() {
    const lesson = this.#currentLesson();
    const step = lesson.steps[this.learnState.stepIdx];
    if (!step) return;
    if (step.fen) {
      this.gameState.loadFen(step.fen);
      this.gameState.setPlayAs(this.gameState.getTurn());
      this.gameState.setOrientation(this.gameState.playAs);
    }
    $('#learn-step-feedback').textContent = '';
    $('#learn-step-feedback').className = 'step-feedback';
    this.#renderCurrentStep();
  }

  #renderCurrentStep() {
    const lesson = this.#currentLesson();
    if (!lesson) return;
    const step = lesson.steps[this.learnState.stepIdx];
    const total = lesson.steps.length;
    $('#learn-progress').style.width = ((this.learnState.stepIdx / total) * 100) + '%';

    const content = $('#learn-step-content');
    content.className = 'step-content ' + (step.type === 'play' ? 'play' : 'teach');
    if (step.type === 'play') {
      content.innerHTML = `<div class="step-prompt">${esc(step.prompt)}</div>`;
    } else {
      content.innerHTML =
        (step.title ? `<div class="step-title">${esc(step.title)}</div>` : '') +
        `<div class="step-text">${esc(step.text || '')}</div>`;
    }

    $('#learn-lesson-title').textContent = lesson.title;

    const actions = $('#learn-step-actions');
    actions.innerHTML = '';
    if (step.type === 'teach') {
      const next = document.createElement('button');
      next.className = 'btn primary'; next.type = 'button';
      next.textContent = this.learnState.stepIdx === total - 1 ? i18n.t('learn.finish') : i18n.t('learn.next');
      next.addEventListener('click', () => this.#advance());
      actions.appendChild(next);
    } else {
      const hint = document.createElement('button');
      hint.className = 'btn ghost'; hint.type = 'button'; hint.textContent = i18n.t('ui.button.showHint');
      hint.addEventListener('click', () => {
        $('#learn-step-feedback').textContent = `💡 ${step.hint || ''}`;
        $('#learn-step-feedback').className = 'step-feedback';
      });
      actions.appendChild(hint);
    }
  }

  #advance() {
    const lesson = this.#currentLesson();
    if (!lesson) return;
    if (this.learnState.stepIdx + 1 >= lesson.steps.length) { this.#complete(); return; }
    this.learnState.nextStep();
    this.#applyStep();
  }

  #complete() {
    const lesson = this.#currentLesson();
    this.prefs.markLessonComplete(lesson.id);
    const content = $('#learn-step-content');
    content.className = 'lesson-complete';
    content.innerHTML = `
      <div class="trophy">🏆</div>
      <h3>${esc(i18n.t('learn.completedHeader'))}</h3>
      <p>${esc(i18n.t('learn.completedBody', { title: lesson.title }))}</p>`;
    $('#learn-progress').style.width = '100%';
    $('#learn-step-feedback').textContent = '';
    const actions = $('#learn-step-actions');
    actions.innerHTML = '';
    const back = document.createElement('button');
    back.className = 'btn primary'; back.type = 'button'; back.textContent = i18n.t('learn.backToLessons');
    back.addEventListener('click', () => {
      this.learnState.goToCategory(this.learnState.catId);
      this.gameState.setMode(MODE_IDS.PRACTICE);
      this.render();
    });
    actions.appendChild(back);
    this.sound.win();
  }

  /** Called by LessonMode.onMove for the user's moves on the board. */
  handleMove(move) {
    const lesson = this.#currentLesson();
    if (!lesson) return;
    const step = lesson.steps[this.learnState.stepIdx];
    if (!step || step.type !== 'play') return;

    const targets = Array.isArray(step.targetSan) ? step.targetSan : [step.targetSan];
    const played = normalizeSan(move.san);
    const ok = targets.some(t => normalizeSan(t) === played);
    if (ok) {
      $('#learn-step-feedback').textContent = '✅ ' + (step.successText || i18n.t('learn.successDefault'));
      $('#learn-step-feedback').className = 'step-feedback good';
      this.sound.good();
      setTimeout(() => this.#advance(), 650);
    } else {
      $('#learn-step-feedback').textContent = '❌ ' + (step.failText || i18n.t('learn.failDefault')) + (step.hint ? `  💡 ${step.hint}` : '');
      $('#learn-step-feedback').className = 'step-feedback bad';
      this.sound.bad();
      setTimeout(() => {
        Chess.undoLast(this.gameState.getChessState());
        this.gameState.lastMove = this.gameState.getChessState().history.length
          ? this.gameState.getChessState().history[this.gameState.getChessState().history.length - 1].move
          : null;
        this.gameState.clearSelection();
      }, 800);
    }
  }

  #currentCategory() {
    if (!this.content.lessons) return null;
    return this.content.lessons.categories.find(c => c.id === this.learnState.catId);
  }
  #currentLesson() {
    const cat = this.#currentCategory();
    return cat ? cat.lessons.find(l => l.id === this.learnState.lessonId) : null;
  }
}

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
