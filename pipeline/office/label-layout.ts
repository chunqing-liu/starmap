export interface LabelRect { x: number; y: number; width: number; height: number }
export function labelOverlaps(left: LabelRect, right: LabelRect) {
  return left.x < right.x + right.width + 3 && left.x + left.width + 3 > right.x && left.y < right.y + right.height + 3 && left.y + left.height + 3 > right.y;
}
export function placeOfficeLabel(anchor: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }, obstacles: LabelRect[]): LabelRect | undefined {
  const fit = (candidate: { x: number; y: number }) => {
    const rect = { ...size, x: Math.max(4, Math.min(viewport.width - size.width - 4, candidate.x)), y: candidate.y };
    return rect.x + rect.width <= viewport.width - 4 && rect.y >= 4 && rect.y + rect.height <= viewport.height - 4 && !obstacles.some(obstacle => labelOverlaps(rect, obstacle)) ? rect : undefined;
  };
  for (const candidate of [
    { x: anchor.x - size.width / 2, y: anchor.y + 26 },
    { x: anchor.x - size.width / 2, y: anchor.y - 65 - size.height },
    { x: anchor.x + 32, y: anchor.y - size.height / 2 },
    { x: anchor.x - 32 - size.width, y: anchor.y - size.height / 2 },
  ]) {
    const rect = fit(candidate); if (rect) return rect;
  }
  let nearest: LabelRect | undefined;
  let distance = Infinity;
  for (let row = 4; row + size.height <= viewport.height - 4; row += size.height + 5) {
    for (let column = 4; column + size.width <= viewport.width - 4; column += 16) {
      const nextDistance = Math.hypot(column + size.width / 2 - anchor.x, row - anchor.y);
      if (nextDistance >= distance) continue;
      const rect = fit({ x: column, y: row });
      if (rect) { nearest = rect; distance = nextDistance; }
    }
  }
  return nearest;
}
