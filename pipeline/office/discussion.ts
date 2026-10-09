import type { Point, World } from './vendor/runtime/model';
import type { NavigationTemplates } from './vendor/runtime/navigationAdapter';
import { officeRouteFromPixel, type LeisurePose } from './leisure';
import { sampleOfficeWalk } from './roster-motion';
import { spotCell, SPOT_IDS } from './scene-objects';

interface DiscussionVisit { route: Point[]; goal: Point; started: number; returning: boolean; swapped: number }
export class OfficeDiscussion {
  private visits = new Map<string, DiscussionVisit>();
  private pausedAt?: number;
  setPaused(paused: boolean, now: number) { if (paused) this.pausedAt ??= now; else if (this.pausedAt !== undefined) { for (const visit of this.visits.values()) visit.started += now - this.pausedAt; this.pausedAt = undefined; } }
  has(id: string) { return this.visits.has(id); }
  forget(id: string) { this.visits.delete(id); }
  get active() { return this.visits.size > 0; }
  retain(ids: string[]) { for (const id of this.visits.keys()) if (!ids.includes(id)) this.visits.delete(id); }
  sample(id: string, group: string[], world: World, templates: NavigationTemplates, homeId: string, home: Point, current: Point, now: number, reduced: boolean): LeisurePose | undefined {
    let visit = this.visits.get(id);
    now = this.pausedAt ?? now;
    const index = group.indexOf(id), returning = index < 0;
    if (!visit && returning) return;
    const swapped = reduced ? 0 : Math.floor(now / 11000) % Math.max(1, group.length);
    const slot = returning ? 0 : (index + swapped) % group.length;
    const goal = returning ? home : spotCell(world, 'board', slot);
    if (!visit || visit.returning !== returning || !reduced && (visit.swapped !== swapped || visit.goal.x !== goal.x || visit.goal.y !== goal.y)) {
      const route = officeRouteFromPixel(world, templates, current, goal, homeId, returning);
      visit = { route, goal, started: now, returning, swapped }; this.visits.set(id, visit);
    }
    const point = reduced ? { x: current.x, y: current.y, facing: 'back' as const, done: false } : sampleOfficeWalk(visit.route, now - visit.started);
    if (point.done && returning) { this.visits.delete(id); return; }
    return { x: point.x, y: point.y, walking: !point.done, returning, seated: false, facing: point.done ? 'back' : point.facing,
      activity: point.done ? slot === 0 ? 'present' : 'listen' : undefined, stage: returning ? 'returning' : point.done ? 'interacting' : 'walking', propId: SPOT_IDS.board, slot, progress: 0 };
  }
}
