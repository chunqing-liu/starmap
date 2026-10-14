import type { PipelineLocalState } from './models/schema';
import { PIPELINE_STORAGE_KEY, sanitizePipelineState } from './models/templates';

export const TEAM_SCHEMA = 'beings:star-map:team-export';
export const TEAM_SPACES_KEY = 'beings:star-map:team-spaces';
export const BACKUP_KEY = 'beings:star-map:pre-import-backup';
export interface TeamStorage {
  getItem(key: string): string | null;
  setItems(patch: Record<string, string | null>): Promise<void>;
}
export interface TeamSpace { state: PipelineLocalState; updated_at?: string }
export interface SpaceCollection { activeSpace: string; spaces: Record<string, TeamSpace> }
export type ImportChoice = 'keep' | 'replace' | 'merge';
export interface ImportReport {
  total: number; added: number; replaced: number; merged: number; kept: number;
  rejected: Array<{ space: string; reason: string }>;
  conflicts: Array<{ space: string; id: string; winner: 'local' | 'import'; before: unknown; after: unknown }>;
}
export interface ParsedTeam {
  spaces: Record<string, TeamSpace>;
  sourceStates: Record<string, PipelineLocalState>;
  total: number;
  rejected: ImportReport['rejected'];
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function sanitizeSpace(value: unknown): PipelineLocalState {
  if (!isRecord(value) || value.schemaVersion !== 4) throw new Error('空间 state.schemaVersion 必须为 4');
  if (!isRecord(value.board) || typeof value.board.name !== 'string' || typeof value.board.id !== 'string') throw new Error('空间 state.board 缺少看板名称或 id');
  if (!Array.isArray(value.demands) || !value.demands.some(item => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string')) throw new Error('空间 state.demands 必须含有效的星轨');
  return sanitizePipelineState(structuredClone(value) as unknown as PipelineLocalState);
}
function readEntry(value: unknown): TeamSpace {
  if (!isRecord(value)) throw new Error('空间值必须为对象并包含 state');
  return { state: sanitizeSpace(value.state), ...(typeof value.updated_at === 'string' ? { updated_at: value.updated_at } : {}) };
}
export function parseTeamPackage(text: string): ParsedTeam {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('团队包 JSON 无法解析，请选择有效的 JSON 文件'); }
  if (!isRecord(value) || value.schema !== TEAM_SCHEMA) throw new Error('团队包 schema 不符，必须为 ' + TEAM_SCHEMA);
  if (typeof value.version !== 'number' || !Number.isFinite(value.version)) throw new Error('团队包 version 必须为数字');
  if (value.version > 1) throw new Error('团队包来自更新的版本，请先升级插件');
  if (!isRecord(value.spaces)) throw new Error('团队包 spaces 必须为对象');
  const spaces: ParsedTeam['spaces'] = Object.create(null), sourceStates: ParsedTeam['sourceStates'] = Object.create(null);
  const rejected: ParsedTeam['rejected'] = [];
  for (const [name, entry] of Object.entries(value.spaces)) {
    try {
      if (!name.trim()) throw new Error('空间名不能为空');
      spaces[name] = readEntry(entry);
      sourceStates[name] = (entry as { state: PipelineLocalState }).state;
    } catch (error) { rejected.push({ space: name, reason: errorText(error) }); }
  }
  return { spaces, sourceStates, total: Object.keys(value.spaces).length, rejected };
}
function readCollection(raw: string | null, extra: string | null): SpaceCollection {
  const spaces: Record<string, TeamSpace> = Object.create(null);
  let activeSpace = '';
  let activeUpdatedAt: string | undefined;
  if (extra) {
    const index: unknown = JSON.parse(extra);
    if (!isRecord(index) || typeof index.activeSpace !== 'string' || !isRecord(index.spaces)) throw new Error('本地团队空间索引损坏，未修改任何数据');
    activeSpace = index.activeSpace;
    activeUpdatedAt = typeof index.activeUpdatedAt === 'string' ? index.activeUpdatedAt : undefined;
    for (const [name, entry] of Object.entries(index.spaces)) spaces[name] = readEntry(entry);
  }
  if (raw) {
    const state: unknown = JSON.parse(raw);
    const normalized = sanitizeSpace(state);
    activeSpace ||= normalized.board.name || normalized.board.id;
    const updatedAt = isRecord(state) && typeof state.updated_at === 'string' ? state.updated_at : activeUpdatedAt;
    spaces[activeSpace] = { state: normalized, ...(updatedAt ? { updated_at: updatedAt } : {}) };
  }
  return { activeSpace, spaces };
}
export const readTeamSpaces = (storage: TeamStorage) => readCollection(storage.getItem(PIPELINE_STORAGE_KEY), storage.getItem(TEAM_SPACES_KEY));
export function createTeamExport(storage: TeamStorage, appVersion: string, date = new Date()) {
  const { spaces } = readTeamSpaces(storage);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = '' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes());
  return {
    fileName: 'starmap-export-' + stamp + '.json',
    data: { schema: TEAM_SCHEMA, version: 1, exported_at: date.toISOString(), app_version: appVersion, spaces },
    demandCount: Object.values(spaces).reduce((count, space) => count + space.state.demands.length, 0),
  };
}
export function downloadTeamExport(exported: ReturnType<typeof createTeamExport>) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(exported.data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = exported.fileName;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function newerLocal(local: unknown, incoming: unknown) {
  const localTime = isRecord(local) && typeof local.updated_at === 'string' ? Date.parse(local.updated_at) : NaN;
  const incomingTime = isRecord(incoming) && typeof incoming.updated_at === 'string' ? Date.parse(incoming.updated_at) : NaN;
  return Number.isFinite(localTime) && Number.isFinite(incomingTime) && localTime > incomingTime;
}
export function planTeamImport(storage: TeamStorage, team: ParsedTeam, choices: Record<string, ImportChoice>) {
  const collection = readTeamSpaces(storage);
  const report: ImportReport = { total: team.total, added: 0, replaced: 0, merged: 0, kept: 0, rejected: team.rejected, conflicts: [] };
  const activeRaw = storage.getItem(PIPELINE_STORAGE_KEY);
  const activeSource = activeRaw ? JSON.parse(activeRaw) as PipelineLocalState : undefined;
  const storedIndex = JSON.parse(storage.getItem(TEAM_SPACES_KEY) || '{}') as { spaces?: Record<string, TeamSpace> };
  for (const [name, incoming] of Object.entries(team.spaces)) {
    const choice = choices[name];
    if (!['keep', 'replace', 'merge'].includes(choice)) throw new Error('请选择空间「' + name + '」的导入方式');
    const local = collection.spaces[name];
    if (choice === 'keep') { report.kept++; continue; }
    if (!local) { collection.spaces[name] = incoming; report.added++; continue; }
    if (choice === 'replace') { collection.spaces[name] = incoming; report.replaced++; continue; }
    const demands = new Map(local.state.demands.map(demand => [demand.id, demand]));
    const localSource = name === collection.activeSpace ? activeSource : storedIndex.spaces?.[name]?.state;
    for (const demand of incoming.state.demands) {
      const before = demands.get(demand.id);
      if (!before) { demands.set(demand.id, demand); continue; }
      if (JSON.stringify(before) === JSON.stringify(demand)) continue;
      const winner = newerLocal(localSource?.demands.find(item => item?.id === demand.id), team.sourceStates[name].demands.find(item => item?.id === demand.id)) ? 'local' : 'import';
      const after = winner === 'local' ? before : demand;
      demands.set(demand.id, after);
      report.conflicts.push({ space: name, id: demand.id, winner, before, after });
    }
    const updatedAt = newerLocal(local, incoming) ? local.updated_at : incoming.updated_at || local.updated_at;
    collection.spaces[name] = { state: sanitizeSpace({ ...local.state, demands: [...demands.values()] }), ...(updatedAt ? { updated_at: updatedAt } : {}) };
    report.merged++;
  }
  if (!collection.spaces[collection.activeSpace]) collection.activeSpace = Object.keys(collection.spaces)[0] || '';
  return { collection, report };
}
function collectionPatch(collection: SpaceCollection): Record<string, string> {
  const current = collection.spaces[collection.activeSpace];
  if (!current) throw new Error('没有可应用的有效空间');
  const spaces = Object.fromEntries(Object.entries(collection.spaces).filter(([name]) => name !== collection.activeSpace));
  return { [PIPELINE_STORAGE_KEY]: JSON.stringify(sanitizeSpace(current.state)), [TEAM_SPACES_KEY]: JSON.stringify({ activeSpace: collection.activeSpace, ...(current.updated_at ? { activeUpdatedAt: current.updated_at } : {}), spaces }) };
}
export async function applyTeamImport(storage: TeamStorage, team: ParsedTeam, choices: Record<string, ImportChoice>) {
  const plan = planTeamImport(storage, team, choices);
  if (!plan.report.added && !plan.report.replaced && !plan.report.merged) return { ...plan, applied: false };
  const patch = collectionPatch(plan.collection);
  const backup = { backed_up_at: new Date().toISOString(), data: {
    [PIPELINE_STORAGE_KEY]: storage.getItem(PIPELINE_STORAGE_KEY), [TEAM_SPACES_KEY]: storage.getItem(TEAM_SPACES_KEY),
  } };
  try { await storage.setItems({ [BACKUP_KEY]: JSON.stringify(backup) }); }
  catch (error) { throw new Error('导入已中止：导入前备份写入失败（' + errorText(error) + '），未应用团队包'); }
  try { await storage.setItems(patch); }
  catch (error) { throw new Error('团队包应用失败（' + errorText(error) + '）；导入前备份已保留，可恢复'); }
  return { ...plan, applied: true };
}
export function readImportBackup(storage: TeamStorage) {
  const raw = storage.getItem(BACKUP_KEY);
  if (!raw) throw new Error('还没有导入前备份');
  let backup: unknown;
  try { backup = JSON.parse(raw); } catch { throw new Error('导入前备份 JSON 无法解析'); }
  if (!isRecord(backup) || typeof backup.backed_up_at !== 'string' || !Number.isFinite(Date.parse(backup.backed_up_at)) || !isRecord(backup.data)) throw new Error('导入前备份格式不符');
  const data: Record<string, string | null> = {};
  for (const key of [PIPELINE_STORAGE_KEY, TEAM_SPACES_KEY]) {
    if (backup.data[key] !== null && typeof backup.data[key] !== 'string') throw new Error('备份 ' + key + ' 格式不符');
    data[key] = backup.data[key] as string | null;
  }
  const collection = readCollection(data[PIPELINE_STORAGE_KEY], data[TEAM_SPACES_KEY]);
  return { backedUpAt: backup.backed_up_at, collection, data };
}
export async function restoreImportBackup(storage: TeamStorage) {
  const backup = readImportBackup(storage);
  const patch: Record<string, string | null> = backup.collection.activeSpace ? collectionPatch(backup.collection) : backup.data;
  if (backup.data[TEAM_SPACES_KEY] === null) patch[TEAM_SPACES_KEY] = null;
  await storage.setItems(patch);
  return backup.collection;
}
export async function switchTeamSpace(storage: TeamStorage, name: string) {
  const collection = readTeamSpaces(storage);
  if (!collection.spaces[name]) throw new Error('所选空间不存在');
  collection.activeSpace = name;
  await storage.setItems(collectionPatch(collection));
  return collection.spaces[name].state;
}
