import type { PipelineLocalState } from './models/schema';
import { PIPELINE_STORAGE_KEY } from './models/templates';
import { NetworkError, sameState, stableJson, validateSpaceName, validateState, type RemoteSpace, type NetworkErrorCode } from './gitlab-client';
import { mergeSpace, type ConflictChoices, type FieldConflict } from './sync-merge';
import type { TeamStorage } from './storage';

export const NETWORK_SPACE_KEY = 'beings:star-map:network-space';
export interface LocalCache { getItem(key: string): string | null; setItems(patch: Record<string, string | null>): Promise<void> }
interface Journal { version: 1; target: string; space: string; draft: PipelineLocalState; base: RemoteSpace | null; pending: PipelineLocalState | null; syncedAt: string | null; initialRemote?: boolean }
export type SyncStatus = 'local' | 'dirty' | 'synced' | 'syncing' | 'offline' | 'conflict' | 'unknown' | 'error';
export class TeamSync {
  private journal: Journal;
  private listeners = new Set<() => void>();
  private saving: Promise<void> | null = null;
  private pendingPersist = false;
  private remoteConflict: RemoteSpace | null = null;
  private active = false;
  private applied = 0;
  private status: SyncStatus = 'local';
  private message = '本地草稿；请先拉取团队空间。';
  private conflicts: FieldConflict[] = [];
  private storageFailed = false;
  private disposed = false;
  private initialRemote: boolean;
  private errorCode: NetworkErrorCode | null = null;
  readonly key: string;
  constructor(readonly remote: TeamStorage, private cache: LocalCache, readonly space: string, initial: PipelineLocalState, readonly account = '', acceptInitialRemote = false) {
    validateSpaceName(space);
    this.key = 'beings:star-map:network:' + encodeURIComponent(remote.target) + ':' + space + (account ? ':account:' + encodeURIComponent(account) : '');
    this.initialRemote = acceptInitialRemote;
    this.journal = { version: 1, target: remote.target, space, draft: validateState(initial), base: null, pending: null, syncedAt: null };
    const saved = cache.getItem(this.key);
    if (saved) {
      let value: Journal;
      try { value = JSON.parse(saved); } catch { throw new NetworkError('format', '联网草稿缓存无法解析；未覆盖缓存，请先保留原数据。'); }
      if (value.version !== 1 || value.target !== remote.target || value.space !== space || (value.base && ((value.base.rev === null) !== (value.base.state === null)))) throw new NetworkError('format', '联网草稿目标或版本不匹配；不会套用到其它空间。');
      this.journal = { ...value, draft: validateState(value.draft), base: value.base ? { ...value.base, state: value.base.state && validateState(value.base.state) } : null, pending: value.pending ? validateState(value.pending) : null };
      this.initialRemote = acceptInitialRemote && value.initialRemote === true;
      this.status = value.pending ? 'unknown' : this.dirty ? 'dirty' : 'synced';
      this.message = value.pending ? '上次写入回执不明；先拉取核对，禁止自动重发。' : this.dirty ? '有待同步的本地草稿。' : '已恢复本地缓存；拉取可核验最新版本。';
    }
  }
  get dirty() { return !this.journal.base?.state || !sameState(this.journal.draft, this.journal.base.state); }
  snapshot() { return { ...this.journal, status: this.status, message: this.message, dirty: this.dirty, busy: this.active, conflicts: this.conflicts, applied: this.applied, storageFailed: this.storageFailed, errorCode: this.errorCode }; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  dispose() { this.disposed = true; this.listeners.clear(); }
  offline() {
    if (this.disposed || ['conflict', 'unknown'].includes(this.status)) return;
    this.status = 'offline'; this.errorCode = 'network'; this.message = '离线待传；本机草稿保留，恢复连接后先检查远端再自动同步。'; this.emit();
  }
  checkpoint() { return this.persist(); }
  private emit(apply = false) { if (apply) this.applied++; this.listeners.forEach(listener => listener()); }
  private persist() {
    if (this.disposed) return Promise.resolve();
    this.pendingPersist = true;
    if (this.saving) return this.saving;
    const saving = Promise.resolve().then(async () => {
      while (this.pendingPersist && !this.disposed) {
        this.pendingPersist = false;
        const text = JSON.stringify({ ...this.journal, initialRemote: this.initialRemote }), draft = JSON.stringify(this.journal.draft);
        const patch = this.account ? { [this.key]: text } : { [this.key]: text, [PIPELINE_STORAGE_KEY]: draft, [NETWORK_SPACE_KEY]: this.space };
        await this.cache.setItems(patch);
      }
    });
    this.saving = saving.then(() => { this.storageFailed = false; }, () => {
      this.storageFailed = true; this.status = 'error'; this.message = '本机保存失败；草稿仍在当前页面，关闭页面可能丢失。请先恢复本机存储。'; this.emit();
      throw new NetworkError('http', this.message);
    }).finally(() => { this.saving = null; });
    return this.saving;
  }
  async stage(state: PipelineLocalState) {
    if (this.disposed) return;
    const clean = validateState(state);
    if (stableJson(clean) === stableJson(this.journal.draft)) return;
    this.initialRemote = false;
    this.journal.draft = clean;
    if (this.remoteConflict?.state) this.conflicts = mergeSpace(this.journal.base?.state || null, clean, this.remoteConflict.state).conflicts;
    if (!this.active && !['unknown', 'conflict', 'offline', 'error'].includes(this.status)) {
      this.status = this.dirty ? 'dirty' : 'synced';
      this.message = this.dirty ? '本地内容已修改，尚未推送到团队。' : '本地内容与最近核验的团队版本一致。';
    }
    this.emit();
    await this.persist();
  }
  private applyRemoteDraft(state: PipelineLocalState) {
    const previous = this.journal.draft;
    this.journal.draft = { ...state, selectedDemandId: state.demands.some(demand => demand.id === previous.selectedDemandId) ? previous.selectedDemandId : state.demands[0].id, board: { ...state.board, currentUserId: previous.board.currentUserId, revision: previous.board.revision } };
    this.emit(true);
  }
  private integrate(remote: RemoteSpace) {
    if (this.disposed) return;
    if (this.initialRemote && remote.state && !this.journal.base?.state) {
      this.initialRemote = false; this.journal.base = remote; this.applyRemoteDraft(remote.state);
      this.journal.syncedAt = new Date().toISOString(); this.status = 'synced'; this.message = '已载入此账号的团队空间，未迁移其它账号或离线草稿。'; return;
    }
    const pending = this.journal.pending;
    if (pending && remote.state && sameState(pending, remote.state)) {
      this.journal.base = remote; this.journal.pending = null; this.journal.syncedAt = new Date().toISOString();
      this.remoteConflict = null; this.conflicts = [];
      this.status = this.dirty ? 'dirty' : 'synced'; this.message = this.dirty ? '已核验上次写入；仍有后续本地编辑待推送。' : '已拉取核验上次写入，无需重复提交。';
      return;
    }
    if (!remote.state) {
      this.conflicts = []; this.remoteConflict = null;
      if (this.journal.base?.state) { this.status = 'conflict'; this.message = '远端空间已被删除；本地草稿保留，不会自动重建。'; this.remoteConflict = remote; return; }
      this.journal.base = remote; this.journal.pending = null; this.status = 'local'; this.message = '已确认远端空间不存在；首次推送需确认迁移本地草稿。'; return;
    }
    const result = mergeSpace(this.journal.base?.state || null, this.journal.draft, remote.state);
    if (result.conflicts.length) {
      this.remoteConflict = remote; this.conflicts = result.conflicts; this.status = 'conflict'; this.message = '存在双方都修改的字段；请逐项选择，不会静默覆盖。'; return;
    }
    this.journal.base = remote; this.journal.pending = null; this.remoteConflict = null; this.conflicts = [];
    this.applyRemoteDraft(result.state); this.journal.syncedAt = new Date().toISOString();
    this.status = this.dirty ? 'dirty' : 'synced'; this.message = this.dirty ? '已安全合并不同字段，等待自动上传。' : '已拉取团队最新版本。';
  }
  private fail(error: unknown) {
    if (this.storageFailed) return;
    const safe = error instanceof NetworkError ? error : new NetworkError('http', '同步未完成；本地草稿保留。');
    this.errorCode = safe.code;
    this.status = this.journal.pending ? 'unknown' : safe.code === 'network' ? 'offline' : safe.code === 'conflict' ? 'conflict' : 'error';
    this.message = safe.message;
  }
  async pull() {
    if (this.active || this.disposed) return;
    this.active = true; this.errorCode = null; this.status = 'syncing'; this.emit();
    try { await this.persist(); this.integrate(await this.remote.load(this.space)); await this.persist(); }
    catch (error) { this.fail(error); }
    finally { this.active = false; this.emit(); }
  }
  async check() {
    if (this.active || this.disposed) return;
    if (!this.journal.base || this.journal.pending) return this.pull();
    this.active = true; this.errorCode = null;
    try {
      const revision = await this.remote.revision(this.space);
      if (this.disposed) return;
      this.journal.syncedAt = new Date().toISOString();
      if (revision !== this.journal.base.rev) { this.integrate(await this.remote.load(this.space)); await this.persist(); }
      else if (this.status === 'offline' || this.status === 'error') { this.status = this.dirty ? 'dirty' : 'synced'; this.message = '已恢复连接并核验远端版本。'; }
    } catch (error) { if (!this.disposed) this.fail(error); }
    finally { this.active = false; if (!this.disposed) this.emit(); }
  }
  async resolve(choices: ConflictChoices) {
    if (this.active || this.disposed || !this.remoteConflict?.state) return;
    const result = mergeSpace(this.journal.base?.state || null, this.journal.draft, this.remoteConflict.state, choices);
    if (result.conflicts.length) throw new NetworkError('conflict', '请先为每个冲突字段选择本地或远端。');
    this.journal.base = this.remoteConflict; this.journal.pending = null; this.remoteConflict = null; this.conflicts = [];
    this.applyRemoteDraft(result.state); this.status = this.dirty ? 'dirty' : 'synced'; this.message = this.dirty ? '冲突已解决，等待自动同步；提交前仍核验远端版本。' : '已采纳远端。';
    await this.persist(); this.emit();
  }
  async push(actor: string, confirmCreate = false) {
    if (this.active || this.disposed) return;
    if (this.journal.pending || this.remoteConflict || this.conflicts.length) { this.message = '请先拉取核对并处理冲突，不能直接重发或覆盖。'; this.emit(); return; }
    if (!this.journal.base) { this.message = '首次推送前请先拉取，核验空间和权限。'; this.emit(); return; }
    if (!this.journal.base.state && !confirmCreate) { this.message = '首次迁移需要用户明确确认。'; this.emit(); return; }
    if (!this.dirty) return;
    this.active = true; this.errorCode = null; this.status = 'syncing'; this.emit();
    const sent = structuredClone(this.journal.draft), revision = this.journal.base.rev;
    try {
      await this.persist(); this.journal.pending = sent; await this.persist();
      const saved = await this.remote.save(this.space, sent, revision, actor);
      if (this.disposed) return;
      this.journal.base = saved; this.journal.pending = null; this.journal.syncedAt = new Date().toISOString();
      this.status = this.dirty ? 'dirty' : 'synced'; this.message = this.dirty ? '本次提交成功；提交期间新增的编辑仍待推送。' : '团队数据已同步。';
      await this.persist();
    } catch (error) {
      if (error instanceof NetworkError && error.code !== 'unknown' && !this.storageFailed) {
        this.journal.pending = null;
        if (error.code === 'conflict') {
          try { this.integrate(await this.remote.load(this.space)); if (this.snapshot().status !== 'conflict') this.message = '提交发生并发变化，已核对并安全合并；等待下一次同步。'; }
          catch (readError) { this.fail(readError); }
        } else this.fail(error);
        try { await this.persist(); } catch {}
      } else this.fail(error);
    } finally { this.active = false; this.emit(); }
  }
}
