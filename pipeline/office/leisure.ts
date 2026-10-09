import { GridNavigation } from './vendor/runtime/navigation';
import type { NavigationTemplates } from './vendor/runtime/navigationAdapter';
import type { Point, World } from './vendor/runtime/model';
import { cellCenter, seatPixels } from './vendor/scene/gridProjection';
import { sampleOfficeWalk } from './roster-motion';
import { SPOT_CAPACITY, SPOT_IDS, spotCell, type OfficeSpot } from './scene-objects';

export const LEISURE_ACTIVITIES = ['phone', 'coffee', 'wander', 'exercise', 'read'] as const;
export type LeisureActivity = typeof LEISURE_ACTIVITIES[number];
export type OfficeScreen = 'off' | 'working' | 'thinking' | 'done';
export type InteractionAction = LeisureActivity | 'brew' | 'present' | 'listen';
export const LEISURE_LABELS: Record<InteractionAction, string> = { phone: '在沙发上刷手机', coffee: '在吧台喝咖啡', brew: '在咖啡机前接咖啡', wander: '在白板前整理思路', exercise: '在健身角做哑铃弯举', read: '在阅读角翻书', present: '在白板前指划讨论', listen: '看白板并听伙伴讲解' };
export const ACTIVITY_SPOT: Record<LeisureActivity, OfficeSpot> = { phone: 'rest', coffee: 'coffee', wander: 'board', exercise: 'exercise', read: 'read' };
export interface LeisurePose extends Point { activity?: InteractionAction; facing: 'front' | 'back' | 'left' | 'right'; walking: boolean; returning: boolean; seated: boolean; stage: 'rising' | 'walking' | 'interacting' | 'returning' | 'waiting'; propId?: string; slot?: number; progress: number }
interface LeisureVisit { activity: LeisureActivity; slot: number; route: Point[]; started: number; arrived?: number; returning: boolean; frozenAt?: number; waitingUntil?: number; goal: Point }

export function leisureTarget(world: World, index: number, activity: LeisureActivity): Point {
  return spotCell(world, ACTIVITY_SPOT[activity], Math.floor(index / LEISURE_ACTIVITIES.length));
}

export function leisureRoute(world: World, templates: NavigationTemplates, from: Point, to: Point, homeId?: string): Point[] {
  const query = homeId ? { contact: { propId: homeId, interactionId: 'seat' } } : {};
  return [from, ...new GridNavigation(templates).path(world, from, to, query)].map(cellCenter);
}

export function officeRouteFromPixel(world: World, templates: NavigationTemplates, pixel: Point, target: Point, homeId: string, seated = false): Point[] {
  const destination = seated ? seatPixels(target) : cellCenter(target);
  if (pixel.x === destination.x && pixel.y === destination.y) return [{ x: pixel.x, y: pixel.y }];
  const navigation = new GridNavigation(templates), query = { contact: { propId: homeId, interactionId: 'seat' } };
  let origin = { x: Math.floor(pixel.x / 50), y: Math.floor(pixel.y / 50) };
  if (!navigation.walkable(world, origin, query)) {
    const candidates: Point[] = [];
    for (let row = 0; row < world.height; row++) for (let column = 0; column < world.width; column++) if (navigation.walkable(world, { x: column, y: row }, query)) candidates.push({ x: column, y: row });
    origin = candidates.sort((first, second) => Math.hypot(first.x * 50 + 25 - pixel.x, first.y * 50 + 25 - pixel.y) - Math.hypot(second.x * 50 + 25 - pixel.x, second.y * 50 + 25 - pixel.y))[0];
  }
  const route = leisureRoute(world, templates, origin, target, homeId), center = route[0];
  route.unshift({ x: pixel.x, y: pixel.y }, { x: center.x, y: pixel.y });
  if (seated) { const end = seatPixels(target), last = route[route.length - 1]; route.push({ x: end.x, y: last.y }, end); }
  return route.filter((point, index) => !index || point.x !== route[index - 1].x || point.y !== route[index - 1].y);
}

export class OfficeLeisure {
  private visits = new Map<string, LeisureVisit>();
  private pausedAt?: number;
  setPaused(paused: boolean, now: number) {
    if (paused) { this.pausedAt ??= now; return; }
    if (this.pausedAt === undefined) return;
    const duration = now - this.pausedAt;
    for (const visit of this.visits.values()) { visit.started += duration; if (visit.arrived !== undefined) visit.arrived += duration; if (visit.waitingUntil !== undefined) visit.waitingUntil += duration; if (visit.frozenAt !== undefined) visit.frozenAt += duration; }
    this.pausedAt = undefined;
  }
  get moving() { return [...this.visits.values()].some(visit => visit.route.length > 1 || visit.arrived === undefined); }
  get active() { return this.visits.size > 0; }
  clear() { this.visits.clear(); }
  forget(id: string) { this.visits.delete(id); }
  has(id: string) { return this.visits.has(id); }
  activity(id: string) { return this.visits.get(id)?.activity; }
  retain(ids: string[]) { const retained = new Set(ids); for (const id of this.visits.keys()) if (!retained.has(id)) this.visits.delete(id); }
  private available(activity: LeisureActivity, id: string, preferred: number, blocked: number) {
    const capacity = SPOT_CAPACITY[ACTIVITY_SPOT[activity]];
    for (let offset = 0; offset < capacity; offset++) {
      const slot = (preferred + offset) % capacity;
      if (activity === 'wander' && slot < blocked) continue;
      if (![...this.visits].some(([other, visit]) => other !== id && !visit.returning && visit.waitingUntil === undefined && visit.activity === activity && visit.slot === slot)) return slot;
    }
    return -1;
  }
  sample(id: string, index: number, world: World, templates: NavigationTemplates, homeId: string, home: Point, now: number, idle: boolean, reduced: boolean, _departing = false, current?: Point, boardReserved = 0, completed = false): LeisurePose | undefined {
    let visit = this.visits.get(id);
    if (!visit && !idle) return;
    now = this.pausedAt ?? now;
    if (visit?.frozenAt !== undefined) {
      if (!reduced) { const pause = now - visit.frozenAt; visit.started += pause; if (visit.arrived !== undefined) visit.arrived += pause; if (visit.waitingUntil !== undefined) visit.waitingUntil += pause; visit.frozenAt = undefined; }
      else now = visit.frozenAt;
    }
    const homePixel = seatPixels(home);
    const routeFrom = (pixel: Point, target: Point, seated = false) => officeRouteFromPixel(world, templates, pixel, target, homeId, seated);
    const begin = (activity: LeisureActivity, pixel: Point, rising: boolean): LeisureVisit => {
      const slot = this.available(activity, id, Math.floor(index / 5), boardReserved);
      const goal = slot < 0 ? home : spotCell(world, ACTIVITY_SPOT[activity], slot);
      const route = routeFrom(pixel, goal, slot < 0);
      return { activity, slot, goal, route, started: now + (rising ? completed ? 1800 : 360 : 0), returning: false, ...(slot < 0 ? { waitingUntil: now + 4000 + index * 37 } : {}) };
    };
    if (!visit) { visit = begin(completed ? 'phone' : LEISURE_ACTIVITIES[index % 5], current || homePixel, true); this.visits.set(id, visit); }
    if (current && visit.activity === 'wander' && visit.arrived !== undefined && !visit.returning && visit.route.length === 1) visit.route = [{ x: current.x, y: current.y }];
    let point = sampleOfficeWalk(visit.route, now - visit.started);
    if (!idle && !visit.returning) {
      const route = routeFrom(point, home, true);
      visit = { ...visit, route, started: now, arrived: undefined, returning: true, waitingUntil: undefined }; this.visits.set(id, visit); point = sampleOfficeWalk(route, 0);
    }
    if (point.done) {
      if (visit.returning) { this.visits.delete(id); return; }
      if (visit.arrived === undefined) visit.arrived = now;
      visit.route = [{ x: point.x, y: point.y }];
      const duration = 19000 + index % 5 * 1300;
      const targetChanged = visit.slot >= 0 && JSON.stringify(visit.goal) !== JSON.stringify(spotCell(world, ACTIVITY_SPOT[visit.activity], visit.slot));
      const nextDue = visit.waitingUntil !== undefined ? now >= visit.waitingUntil : now - visit.arrived >= duration;
      if (!reduced && (targetChanged || nextDue)) {
        const next = visit.waitingUntil !== undefined || targetChanged ? visit.activity : LEISURE_ACTIVITIES[(LEISURE_ACTIVITIES.indexOf(visit.activity) + 1) % 5];
        visit = begin(next, point, false); this.visits.set(id, visit); point = sampleOfficeWalk(visit.route, 0);
      }
    }
    if (reduced && visit.frozenAt === undefined) visit.frozenAt = now;
    const elapsed = Math.max(0, now - (visit.arrived ?? now));
    const interacting = point.done && now >= visit.started && visit.slot >= 0;
    const activity = interacting ? visit.activity === 'coffee' && elapsed < 4200 ? 'brew' : visit.activity : undefined;
    const seated = interacting && (visit.activity === 'phone' || visit.activity === 'read');
    return { x: point.x, y: point.y, activity, seated, facing: interacting ? visit.activity === 'coffee' || visit.activity === 'wander' ? 'back' : 'front' : point.facing, walking: !point.done && now >= visit.started, returning: visit.returning,
      stage: visit.returning ? 'returning' : now < visit.started ? 'rising' : interacting ? 'interacting' : visit.waitingUntil !== undefined && point.done ? 'waiting' : 'walking',
      propId: visit.slot >= 0 ? SPOT_IDS[ACTIVITY_SPOT[visit.activity]] : undefined, slot: visit.slot, progress: elapsed / (19000 + index % 5 * 1300) };
  }
}
