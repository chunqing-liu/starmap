import { validateSpaceName } from './gitlab-client';

/**
 * 围炉钥匙：本围炉共用的团队空间信息，由成员以 being 身份发在围炉里，
 * 形如一行 `STARMAP-KEY:{"projectId":730,...}`。插件读围炉消息自动取用，
 * 成员不必再手填入口/项目/分支/空间。
 */
export const RING_KEY_PREFIX = 'STARMAP-KEY:';

export interface RingSpace {
  ringId: string;
  ringName: string;
  endpoint: string;
  projectId: number;
  branch: string;
  space: string;
  token: string;
}

export interface RingMessage { message?: unknown; at?: unknown }
export interface RingSummary { id: string; name: string }

type TownQueryResult = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string };
export type TownQuery = (query: { kind: string; id?: string; offset?: number }) => Promise<TownQueryResult>;

/** 只认明确的 origin、正整数项目、合法分支与空间；任何一项不合规就整条丢弃，不做猜测。 */
function readRingKey(raw: unknown, ring: RingSummary): RingSpace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : '';
  const token = typeof value.token === 'string' ? value.token.trim() : '';
  const branch = typeof value.branch === 'string' ? value.branch.trim() : '';
  const space = typeof value.space === 'string' ? value.space.trim() : '';
  const projectId = typeof value.projectId === 'number' ? value.projectId : Number(value.projectId);
  let origin: URL;
  try { origin = new URL(endpoint); } catch { return null; }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) return null;
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return null;
  if (!token || /[\s"'<>]/.test(token)) return null;
  if (!branch || /\.\.|\/\/|[/.]$|\.lock$|[\s"'<>]/.test(branch)) return null;
  try { validateSpaceName(space); } catch { return null; }
  return { ringId: ring.id, ringName: ring.name, endpoint: origin.origin, projectId, branch, space, token };
}

/** 从一条围炉消息里取钥匙：只认以 STARMAP-KEY: 开头的那一行。 */
export function parseRingKeyMessage(text: string, ring: RingSummary): RingSpace | null {
  if (typeof text !== 'string' || !text) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(RING_KEY_PREFIX)) continue;
    const payload = trimmed.slice(RING_KEY_PREFIX.length).trim();
    if (!payload) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { continue; }
    const key = readRingKey(parsed, ring);
    if (key) return key;
  }
  return null;
}

/** 一个围炉里有多条钥匙时取最新那条（消息按时间正序）。 */
export function latestRingKey(messages: RingMessage[] | unknown, ring: RingSummary): RingSpace | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const text = messages[index] && typeof messages[index] === 'object' ? (messages[index] as RingMessage).message : null;
    if (typeof text !== 'string') continue;
    const key = parseRingKeyMessage(text, ring);
    if (key) return key;
  }
  return null;
}

function ringsOf(data: Record<string, unknown> | undefined): RingSummary[] {
  const list: RingSummary[] = [];
  for (const field of ['joined', 'owned']) {
    const items = data?.[field];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const id = typeof entry.id === 'number' || typeof entry.id === 'string' ? String(entry.id) : '';
      const name = typeof entry.name === 'string' ? entry.name : '';
      if (!/^\d{1,16}$/.test(id) || !name || list.some(ring => ring.id === id)) continue;
      list.push({ id, name });
    }
  }
  return list;
}

function messagesOf(data: Record<string, unknown> | undefined): unknown[] | null {
  const messages = data?.messages;
  return Array.isArray(messages) ? messages : null;
}

export interface RingDiscovery {
  spaces: RingSpace[];
  note: string;
  /** 多少个围炉被读到（用于区分「没有钥匙」和「读不到围炉」）。 */
  ringsSeen: number;
}

/**
 * 读当前 being 已加入的围炉，找出带钥匙的团队空间。
 * 读不到（宿主没开 town 能力、断网、围炉为空）都只记为 note，不阻断手动填写的路径。
 */
export async function discoverRingSpaces(query: TownQuery, limit = 6): Promise<RingDiscovery> {
  let list: TownQueryResult;
  try { list = await query({ kind: 'firesides' }); }
  catch { return { spaces: [], note: '读不到围炉列表，可以先用下面的手动填写。', ringsSeen: 0 }; }
  if (!list || list.ok !== true) return { spaces: [], note: '读不到围炉列表，可以先用下面的手动填写。', ringsSeen: 0 };
  const rings = ringsOf(list.data).slice(0, limit);
  if (!rings.length) return { spaces: [], note: '你还没有加入任何围炉；加入后有钥匙的围炉会自动出现在这里。', ringsSeen: 0 };
  const spaces: RingSpace[] = [];
  let readable = 0, failed = 0;
  for (const ring of rings) {
    let heard: TownQueryResult;
    try { heard = await query({ kind: 'fireside', id: ring.id }); }
    catch { failed++; continue; }
    if (!heard || heard.ok !== true) { failed++; continue; }
    readable++;
    const messages = messagesOf(heard.data);
    if (!messages) continue;
    const key = latestRingKey(messages, ring);
    if (key && !spaces.some(space => space.endpoint === key.endpoint && space.projectId === key.projectId && space.space === key.space)) spaces.push(key);
  }
  const note = spaces.length
    ? ''
    : readable
      ? '这个 being 加入的围炉里还没有团队空间钥匙；等有人发钥匙，或先用下面的手动填写。'
      : `围炉消息暂时读不到${failed ? '（' + failed + ' 个失败）' : ''}，可以先用下面的手动填写。`;
  return { spaces, note, ringsSeen: readable };
}
