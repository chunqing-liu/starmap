import type { PipelineLocalState } from './models/schema';
import { sharedState, stableJson, validateState } from './gitlab-client';

export interface FieldConflict { path: string; local: unknown; remote: unknown; localDeleted: boolean; remoteDeleted: boolean }
export type ConflictChoices = Record<string, 'local' | 'remote'>;
export function mergeSpace(base: PipelineLocalState | null, local: PipelineLocalState, remote: PipelineLocalState, choices: ConflictChoices = {}) {
  const conflicts: FieldConflict[] = [];
  const merge = (before: unknown, mine: unknown, theirs: unknown, location: string): unknown => {
    if (stableJson(mine) === stableJson(theirs)) return mine;
    if (stableJson(before) === stableJson(mine)) return theirs;
    if (stableJson(before) === stableJson(theirs)) return mine;
    const records = [mine, theirs].every(value => value !== null && typeof value === 'object' && !Array.isArray(value));
    if (records && (before === undefined || (before !== null && typeof before === 'object' && !Array.isArray(before)))) {
      const result: Record<string, unknown> = Object.create(null);
      const previous = (before || {}) as Record<string, unknown>, first = mine as Record<string, unknown>, second = theirs as Record<string, unknown>;
      for (const key of new Set([...Object.keys(previous), ...Object.keys(first), ...Object.keys(second)])) {
        const value = merge(previous[key], first[key], second[key], location + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    const arrays = [before ?? [], mine, theirs];
    const keyed = arrays.every(value => Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof item.id === 'string') && new Set(value.map(item => item.id)).size === value.length);
    if (keyed) {
      const [previous, first, second] = arrays.map(value => new Map((value as Array<{ id: string }>).map(item => [item.id, item])));
      const result = new Map<string, unknown>();
      for (const identifier of new Set([...first.keys(), ...second.keys(), ...previous.keys()])) {
        const value = merge(previous.get(identifier), first.get(identifier), second.get(identifier), location + '/@' + identifier.replaceAll('~', '~0').replaceAll('/', '~1'));
        if (value !== undefined) result.set(identifier, value);
      }
      if (location.endsWith('/activityEvents')) return [...result.values()];
      const order = (items: Map<string, unknown>) => [...items.keys()].filter(identifier => result.has(identifier));
      const chosen = merge(order(previous), order(first), order(second), location + '/$order') as string[];
      return [...new Set([...chosen, ...result.keys()])].map(identifier => result.get(identifier));
    }
    const choice = choices[location];
    if (!choice) conflicts.push({ path: location, local: mine, remote: theirs, localDeleted: mine === undefined, remoteDeleted: theirs === undefined });
    return choice === 'remote' ? theirs : mine;
  };
  const state = merge(base ? sharedState(base) : undefined, sharedState(local), sharedState(remote), '') as PipelineLocalState;
  return { state: validateState(state), conflicts };
}
