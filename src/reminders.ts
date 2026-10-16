import type { Demand, PipelineNode } from './models/schema';
import { currentNodes } from './activity';

export interface DirectoryEntry { id: string; name: string }
export interface VerifiedDirectory { entries: DirectoryEntry[]; verifiedAt: number }
export interface ReminderRecipient { id: string; name: string; nodeIds: string[] }
export interface ReminderPlan { key: string; demandId: string; recipients: ReminderRecipient[]; blocked: string[] }
export interface ReminderResult { recipientId: string; status: 'simulated-delivered' | 'failed' | 'pending'; at: number }
export interface ReminderAttempt { id: string; key: string; at: number; results: ReminderResult[] }
export interface ReminderCache { getItem(key: string): string | null; setItems(patch: Record<string, string | null>): Promise<void> }
export const REMINDER_STORAGE_KEY = 'starmap:simulated-reminders:v1';
export const REMINDER_WINDOW_MS = 5 * 60 * 1000;
const validId = (id: string) => /^t_[A-Za-z0-9_-]{1,160}$/.test(id);

export function verifyDirectory(data: Record<string, unknown>, now = Date.now()): VerifiedDirectory {
  if (!Array.isArray(data.entries) || (typeof data.count === 'number' && data.count > data.entries.length)) throw new Error('通讯录不完整，不能核验地址');
  const entries: DirectoryEntry[] = [];
  for (const value of data.entries) {
    if (!value || typeof value !== 'object') throw new Error('通讯录格式无法核验');
    const entry = value as Record<string, unknown>;
    if (typeof entry.town_id !== 'string' || !validId(entry.town_id) || entries.some(item => item.id === entry.town_id)) throw new Error('通讯录地址无效或重复');
    entries.push({ id: entry.town_id, name: typeof entry.display_name === 'string' ? entry.display_name : entry.town_id });
  }
  return { entries, verifiedAt: now };
}

export function reminderPlan(demand: Demand, nodes: PipelineNode[], directory: VerifiedDirectory | null, now = Date.now()): ReminderPlan {
  const active = currentNodes(nodes);
  const blocked: string[] = [];
  const recipients: ReminderRecipient[] = [];
  const fresh = directory && now >= directory.verifiedAt && now - directory.verifiedAt < REMINDER_WINDOW_MS;
  if (!active.length) blocked.push('没有已进入的当前节点');
  for (const node of active) {
    const ids = [...new Set(node.responsibleBeingIds || [])];
    if (!ids.length) blocked.push(node.title + '：未绑定负责 Being 地址');
    for (const id of ids) {
      const entry = fresh && validId(id) ? directory.entries.find(item => item.id === id) : undefined;
      if (!entry) { blocked.push(node.title + '：地址未通过本次通讯录核验'); continue; }
      const existing = recipients.find(item => item.id === id);
      if (existing) existing.nodeIds.push(node.id);
      else recipients.push({ id, name: entry.name, nodeIds: [node.id] });
    }
  }
  recipients.sort((left, right) => left.id.localeCompare(right.id));
  const key = JSON.stringify([demand.id, active.map(node => [node.id, node.status, [...new Set(node.responsibleBeingIds || [])].sort(),
    (demand.activityEvents || []).filter(event => event.nodeId === node.id).at(-1)?.id || null]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))]);
  return { key, demandId: demand.id, recipients, blocked };
}

export class SimulatedReminderService {
  private running = false;
  constructor(private cache: ReminderCache, private simulate: (recipient: ReminderRecipient) => Promise<boolean> = async () => true, private now = () => Date.now()) {}
  async run(plan: ReminderPlan, retryFailed = false): Promise<ReminderAttempt> {
    if (this.running) throw new Error('模拟催办正在处理，请勿重复点击');
    if (plan.blocked.length || !plan.recipients.length) throw new Error('先核验全部当前负责 Being 地址');
    this.running = true;
    try {
      const raw = this.cache.getItem(REMINDER_STORAGE_KEY);
      const attempts: ReminderAttempt[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(attempts)) throw new Error('模拟催办记录无法读取，停止以避免重复');
      const existing = attempts.filter(attempt => attempt.key === plan.key).at(-1);
      if (existing?.results.some(result => result.status === 'pending')) throw new Error('上次模拟结果未确认，不能自动重放');
      const recent = existing && this.now() - existing.at < REMINDER_WINDOW_MS;
      if (recent && !retryFailed) throw new Error('相同当前节点和负责人在五分钟内已模拟催办');
      if (retryFailed && (!existing || !recent || !existing.results.some(result => result.status === 'failed'))) throw new Error('没有可重试的失败收件人');
      const attempt: ReminderAttempt = { id: crypto.randomUUID(), key: plan.key, at: this.now(), results: plan.recipients.map(recipient => {
        const prior = retryFailed ? existing?.results.find(result => result.recipientId === recipient.id) : undefined;
        return prior?.status === 'simulated-delivered' ? { ...prior } : { recipientId: recipient.id, status: 'pending', at: this.now() };
      }) };
      const retained = [...attempts, attempt];
      const save = () => this.cache.setItems({ [REMINDER_STORAGE_KEY]: JSON.stringify(retained) });
      await save();
      for (const result of attempt.results) {
        if (result.status !== 'pending') continue;
        try { result.status = await this.simulate(plan.recipients.find(recipient => recipient.id === result.recipientId)!) ? 'simulated-delivered' : 'failed'; }
        catch { result.status = 'failed'; }
        result.at = this.now();
        await save();
      }
      return attempt;
    } finally { this.running = false; }
  }
}
