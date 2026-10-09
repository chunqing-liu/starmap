import { expect, it } from 'vitest';
import { placeOfficeLabel, labelOverlaps } from '../desktop/renderer/pipeline/office/label-layout';
import { loadPipelineState } from '../desktop/renderer/pipeline/models/templates';
import { projectOffice } from '../desktop/renderer/pipeline/office/projection';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';
it('label placement avoids furniture, edges and other labels at small widths', () => {
  const obstacle = { x: 10, y: 30, width: 150, height: 110 };
  const viewport = { width: 180, height: 210 };
  const label = placeOfficeLabel({ x: 8, y: 70 }, { width: 120, height: 20 }, viewport, [obstacle])!;
  expect(label).toBeDefined(); expect(labelOverlaps(label, obstacle)).toBe(false);
  expect(label.x).toBeGreaterThanOrEqual(4); expect(label.x + label.width).toBeLessThanOrEqual(176);
  const second = placeOfficeLabel({ x: 175, y: 70 }, { width: 120, height: 20 }, viewport, [obstacle, label])!;
  expect(second).toBeDefined(); expect(labelOverlaps(second, label)).toBe(false);
});
it('a fully occupied viewport omits a label rather than drawing over furniture', () => {
  expect(placeOfficeLabel({ x: 20, y: 30 }, { width: 70, height: 20 }, { width: 100, height: 100 }, [{ x: 0, y: 0, width: 100, height: 100 }])).toBeUndefined();
});
it('seed reviews are demo but ordinary local tasks are not inferred from connection state', () => {
  const state = loadPipelineState(); const projection = projectOffice(state, DEMO_IDENTITIES);
  expect(projection.reviews.length).toBeGreaterThan(0); expect(projection.reviews.every(task => task.demo)).toBe(true);
  state.demands.forEach(demand => { demand.demo = false; });
  expect(projectOffice(state, DEMO_IDENTITIES).reviews.every(task => !task.demo)).toBe(true);
});
