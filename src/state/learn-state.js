/**
 * State for the Learn tab. Tracks which category/lesson/step the user is on.
 * View objects subscribe to changes via the bus.
 */
export class LearnState {
  constructor() {
    this.view = 'categories';   // 'categories' | 'lessons' | 'steps'
    this.catId = null;
    this.lessonId = null;
    this.stepIdx = 0;
  }

  goToCategories() { this.view = 'categories'; }
  goToCategory(catId) { this.catId = catId; this.view = 'lessons'; }
  startLesson(catId, lessonId) {
    this.catId = catId;
    this.lessonId = lessonId;
    this.stepIdx = 0;
    this.view = 'steps';
  }
  nextStep() { this.stepIdx++; }
  isOnSteps() { return this.view === 'steps'; }
}
