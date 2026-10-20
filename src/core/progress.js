// Journey progress. Navigation is strict: the only enterable location is the first
// one not yet completed. Dev mode (?dev=1) unlocks every location.

export class JourneyProgress {
  constructor(locations, { unlockAll = false } = {}) {
    this.locations = locations;
    this.unlockAll = unlockAll;
    this.completed = new Set();
  }

  get nextLocation() {
    return this.locations.find((l) => !this.completed.has(l.id)) ?? null;
  }

  get completedCount() {
    return this.completed.size;
  }

  get isFinished() {
    return this.locations.every((l) => this.completed.has(l.id));
  }

  isCompleted(id) {
    return this.completed.has(id);
  }

  canEnter(id) {
    return this.unlockAll || this.nextLocation?.id === id;
  }

  markerState(loc) {
    const state = this.completed.has(loc.id)
      ? 'completed'
      : this.nextLocation?.id === loc.id
        ? 'next'
        : this.unlockAll
          ? 'available'
          : 'locked';
    return { state, clickable: this.canEnter(loc.id) };
  }

  complete(id) {
    this.completed.add(id);
  }
}
