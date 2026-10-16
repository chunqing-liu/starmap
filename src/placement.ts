import type { PipelinePoint } from './models/schema';

export type PlacementRect = PipelinePoint & { width: number; height: number };

export function findVacantPosition(candidate: PlacementRect, obstacles: PlacementRect[], gap = 20): PipelinePoint {
  const horizontal = new Set([candidate.x]), vertical = new Set([candidate.y]);
  for (const obstacle of obstacles) {
    horizontal.add(obstacle.x - candidate.width - gap); horizontal.add(obstacle.x + obstacle.width + gap);
    vertical.add(obstacle.y - candidate.height - gap); vertical.add(obstacle.y + obstacle.height + gap);
  }
  const choices = [...horizontal].flatMap(horizontalPosition => [...vertical].map(verticalPosition => ({ x: horizontalPosition, y: verticalPosition })));
  const distance = (point: PipelinePoint) => (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
  choices.sort((first, second) => distance(first) - distance(second));
  return choices.find(point => obstacles.every(obstacle => point.x + candidate.width + gap <= obstacle.x || point.x >= obstacle.x + obstacle.width + gap || point.y + candidate.height + gap <= obstacle.y || point.y >= obstacle.y + obstacle.height + gap))!;
}
