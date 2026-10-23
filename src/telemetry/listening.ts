import type { Track } from '../types/index.js';
import { trackEvent, newSessionId } from './events.js';

/* One listening session per playback of a track. Interpretation rules:
   - a play request is not a listen: «started» flips only when audio really plays;
   - errors, unavailable tracks and buffering are never a skip (endReason error/unavailable, ignored by ranking);
   - a manual «next» before the end is «manual-skip», the automatic move after the last second is «natural»;
   - seeking to the end is not a full listen: uniqueRatio counts only media seconds actually played, each once
     (pauses, buffering and replayed parts add nothing), measured in track time, so playback speed doesn't inflate it;
   - leaving the page finishes the session as «interrupted». */
export type EndReason = 'natural' | 'manual-skip' | 'stop' | 'error' | 'unavailable' | 'interrupted' | 'replaced';

/** Merged [start, end) intervals of track time that really played. */
export class Coverage {
  private spans: Array<[number, number]> = [];
  add(from: number, to: number) {
    if (!(to > from)) return;
    const spans = [...this.spans, [from, to] as [number, number]].sort((a, b) => a[0] - b[0]), merged: Array<[number, number]> = [];
    for (const span of spans) { const last = merged[merged.length - 1]; if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([...span]); }
    this.spans = merged.slice(-200);
  }
  total() { return this.spans.reduce((sum, [a, b]) => sum + (b - a), 0); }
}

export class ListeningSession {
  readonly id = newSessionId();
  started = false; ended = false; failed: 'error' | 'unavailable' | null = null;
  listenedMs = 0; seeks = 0; pauses = 0; repeats = 0;
  private coverage = new Coverage();
  private lastPos: number | null = null; private lastTick = 0; private playing = false; private finished = false;
  constructor(readonly track: Track, readonly context: string, private speed: () => number, private emit = trackEvent) {
    emit('play_request', track, this.id, context, {});
  }
  audioStarted() { if (this.started) return; this.started = true; this.emit('play_start', this.track, this.id, this.context, {}); }
  state(playing: boolean, buffering: boolean) {
    if (this.playing && !playing && !buffering && this.started && !this.ended) this.pauses++;
    this.playing = playing && !buffering; this.lastTick = performance.now();
  }
  /** Called with the audio clock: only continuous forward progress counts as played. */
  time(position: number, now = performance.now()) {
    if (this.playing && this.started) {
      const wall = now - this.lastTick;
      if (wall > 0 && wall < 3000) this.listenedMs += wall;
      if (this.lastPos !== null) { const step = position - this.lastPos; if (step > 0 && step <= Math.max(1.5, 1.5 * this.speed() * wall / 1000 + 0.75)) this.coverage.add(this.lastPos, position); }
    }
    this.lastPos = position; this.lastTick = now;
  }
  seek(position: number) { this.seeks++; this.lastPos = position; }
  endedNaturally(loopsAgain: boolean) { if (loopsAgain) { this.repeats++; this.lastPos = 0; } else this.ended = true; }
  fail(kind: 'error' | 'unavailable') { this.failed = kind; }
  uniqueRatio() { const d = this.track.duration || 0; return d > 0 ? Math.min(1, this.coverage.total() / d) : 0; }
  /** Emits the summary once; later calls are ignored (duplicate «ended»/track-change signals). */
  finish(reason: Exclude<EndReason, 'natural'> | 'auto') {
    if (this.finished) return;
    this.finished = true;
    const endReason: EndReason = this.failed ? this.failed : this.ended ? 'natural' : reason === 'auto' ? 'replaced' : reason;
    this.emit('listen', this.track, this.id, this.context, {
      started: this.started, endReason, listenedMs: Math.round(this.listenedMs), uniqueRatio: Math.round(this.uniqueRatio() * 1000) / 1000,
      repeats: this.repeats, seeks: this.seeks, pauses: this.pauses, speed: Math.round(this.speed() * 100) / 100,
      duration: Math.round(this.track.duration || 0), position: Math.round(this.lastPos || 0),
    });
  }
}
