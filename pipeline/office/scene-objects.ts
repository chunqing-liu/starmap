import type { Point, Prop, World } from './vendor/runtime/model';
import type { ScenePlugin } from './vendor/runtime/plugins';

export type OfficeSpot = 'coffee' | 'board' | 'exercise' | 'read' | 'rest';
export const SPOT_IDS: Record<OfficeSpot, string> = { coffee: 'coffee-corner', board: 'collab-board', exercise: 'fitness-corner', read: 'reading-corner', rest: 'rest-corner' };
export const SPOT_CAPACITY: Record<OfficeSpot, number> = { coffee: 2, board: 3, exercise: 2, read: 2, rest: 3 };

export const officeSceneObjects: ScenePlugin = {
  id: 'starmap.objects', name: '工作室场景物件', version: '1.0.0', apiVersion: 1, dependencies: ['office.objects'],
  templates: (['coffee', 'exercise', 'read', 'rest'] as const).map(spot => ({
    id: 'starmap.' + spot, name: { coffee: '咖啡角', exercise: '健身角', read: '阅读角', rest: '休息区' }[spot], view: spot,
    footprint: { left: 0, right: spot === 'read' || spot === 'rest' ? 3 : 2, top: 0, bottom: 1 },
    anchors: { use: { x: 0, y: 1 } },
    interactions: { use: { name: '场景交互', anchor: 'use', approaches: ['use'], cells: [], posture: spot === 'read' || spot === 'rest' ? 'seated' as const : 'standing' as const, facing: 'front' as const, resource: 'use' } },
    resources: { use: 1 },
  })),
};

export function sceneObjects(width: number, height: number): Prop[] {
  const props: Prop[] = (['coffee', 'exercise', 'read', 'rest'] as const).map((spot, index) => ({
    id: SPOT_IDS[spot], name: { coffee: '咖啡角', exercise: '健身角', read: '阅读角', rest: '休息区' }[spot],
    templateId: 'starmap.' + spot, position: { x: 1 + index * 4, y: height - 4 }, state: {}, stateRevision: 0,
  }));
  return [...props, { id: SPOT_IDS.board, name: '白板讨论区', templateId: 'office.whiteboard', position: { x: width - 5, y: 1 }, anchors: { reader2: { x: 1, y: 1 }, reader3: { x: 2, y: 1 } }, state: { title: '白板协作', text: '团队工作备忘' }, stateRevision: 0 }];
}

export function spotCell(world: World, spot: OfficeSpot, slot: number): Point {
  const prop = world.props.find(item => item.id === SPOT_IDS[spot])!;
  return { x: prop.position.x + slot % SPOT_CAPACITY[spot], y: prop.position.y + 1 };
}
