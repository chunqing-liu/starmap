import { GridNavigation } from './vendor/runtime/navigation';
import type { NavigationTemplates } from './vendor/runtime/navigationAdapter';
import type { Point, World } from './vendor/runtime/model';
import { cellCenter, seatPixels } from './vendor/scene/gridProjection';

export function officeWalkRoute(world: World, templates: NavigationTemplates, homeId: string, position: Point, entering: boolean): Point[] {
  const doorway = { x: 0, y: world.height - 2 };
  const navigation = new GridNavigation(templates);
  const start = entering ? doorway : position, end = entering ? position : doorway;
  const route = [start, ...navigation.path(world, start, end, { contact: { propId: homeId, interactionId: 'seat' } })].map(cellCenter);
  route[entering ? route.length - 1 : 0] = seatPixels(position);
  return route;
}

export function officeReturnRoute(route: Point[], elapsedMs: number): Point[] {
  let remaining = Math.max(0, elapsedMs) * .22;
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1], end = route[index], length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining < length) {
      const progress = remaining / length;
      return [{ x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress }, ...route.slice(0, index).reverse()];
    }
    remaining -= length;
  }
  return [...route].reverse();
}

export function sampleOfficeWalk(route: Point[], elapsedMs: number): Point & { facing: 'front' | 'back' | 'left' | 'right'; done: boolean } {
  let remaining = Math.max(0, elapsedMs) * .22;
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1], end = route[index], length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining < length) {
      const progress = remaining / length;
      return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress, facing: end.y < start.y ? 'back' : end.y > start.y ? 'front' : end.x < start.x ? 'left' : 'right', done: false };
    }
    remaining -= length;
  }
  return { ...route[route.length - 1], facing: 'back', done: true };
}
