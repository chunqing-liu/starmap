import type { OfficeIdentity } from './identities';
import type { OfficeRuntime } from './vendor/runtime/OfficeRuntime';
import { createStarmapWorld } from './world';

export function appendOfficeIdentities(runtime: OfficeRuntime, identities: OfficeIdentity[]) {
  const current = runtime.readWorld();
  const added = identities.filter(identity => !current.actors.some(actor => actor.id === identity.id));
  if (!added.length) return;
  if (current.actors.length + added.length > 100) throw new Error('ROSTER_CAPACITY');
  const initial = createStarmapWorld(added);
  const columns = Math.max(1, Math.min(6, identities.length <= 3 ? identities.length : Math.ceil(Math.sqrt(identities.length * 1.4))));
  const occupied = new Set(current.props.map(prop => prop.position.x + ':' + prop.position.y));
  const reservedRows = new Set(current.props.filter(prop => prop.templateId.startsWith('starmap.')).flatMap(prop => [prop.position.y - 1, prop.position.y, prop.position.y + 1, prop.position.y + 2]));
  const desks = initial.props.filter(prop => prop.templateId === 'office.workstation').map(prop => {
    let slot = 0;
    while (occupied.has((2 + slot % columns * 4) + ':' + (3 + Math.floor(slot / columns) * 4)) || reservedRows.has(3 + Math.floor(slot / columns) * 4) || reservedRows.has(4 + Math.floor(slot / columns) * 4)) slot++;
    const position = { x: 2 + slot % columns * 4, y: 3 + Math.floor(slot / columns) * 4 };
    occupied.add(position.x + ':' + position.y);
    return { ...prop, position };
  });
  const actors = initial.actors.map((actor, index) => ({ ...actor, position: { x: desks[index].position.x, y: desks[index].position.y + 1 } }));
  runtime.appendOfficeRoster(actors, desks, Math.max(current.height, ...desks.map(desk => desk.position.y + 11)), Math.max(current.width, ...desks.map(desk => desk.position.x + 5)));
}
