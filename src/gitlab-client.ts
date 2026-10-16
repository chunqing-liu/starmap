import type { PipelineLocalState } from './models/schema';
import { sanitizePipelineState } from './models/templates';
import { validActivityEvents } from './activity';

export const AUTHORIZED_HTTP_ORIGIN = 'http://newgit.d5techs.com.cn';
export type HostFetch = (url: string, init?: { method?: string; headers?: HeadersInit; body?: string }) => Promise<Response>;
export type CredentialProvider = () => Promise<string | null>;
export type NetworkErrorCode = 'credentials' | 'insecure' | 'forbidden' | 'missing' | 'missing-branch' | 'network' | 'conflict' | 'unknown' | 'format' | 'http';
export class NetworkError extends Error {
  constructor(public code: NetworkErrorCode, message: string) { super(message); }
}
export interface RemoteSpace { state: PipelineLocalState | null; rev: string | null; metaRev: string | null }
export interface RepositoryConfig { baseUrl: string; projectId: number; branch: string }
export function requireSecureRepository(config: RepositoryConfig) {
  const address = new URL(config.baseUrl);
  if (address.username || address.password || address.search || address.hash || address.pathname !== '/') throw new NetworkError('format', 'GitLab 入口只能填写不含凭据、路径或参数的 origin。');
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && address.origin === AUTHORIZED_HTTP_ORIGIN)) throw new NetworkError('insecure', '安全阻断：HTTP 仅允许已授权的公司 origin http://newgit.d5techs.com.cn；其它地址仍须使用 HTTPS。');
}
function assertPreserved(source: unknown, normalized: unknown) {
  if (source === undefined) return;
  if (Array.isArray(source)) {
    if (!Array.isArray(normalized) || source.length !== normalized.length) throw new NetworkError('format', '数据清洗会丢弃集合项；已停止同步，原草稿保留。');
    source.forEach((item, index) => assertPreserved(item, normalized[index]));
  } else if (source && typeof source === 'object') {
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) throw new NetworkError('format', '数据包含不兼容的结构；已停止同步。');
    for (const [key, value] of Object.entries(source)) assertPreserved(value, (normalized as Record<string, unknown>)[key]);
  } else if (source !== normalized) throw new NetworkError('format', '数据包含当前版本无法保留的字段或值；不会静默清洗或覆盖，请先核验版本与数据。');
}
export function validateSpaceName(space: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space)) throw new NetworkError('format', '空间标识只能包含 1–80 位英文字母、数字、下划线和连字符。');
  return space;
}
export function validateState(value: unknown): PipelineLocalState {
  const candidate = value as PipelineLocalState | null;
  if (!candidate || candidate.schemaVersion !== 4 || !candidate.board || typeof candidate.board !== 'object' || Array.isArray(candidate.board) || !Array.isArray(candidate.demands) || !candidate.demands.length) throw new NetworkError('format', '远端或缓存不是有效的 v4 星图；不会覆盖现有数据。');
  const identifiers = candidate.demands.map(demand => demand?.id);
  if (identifiers.some(identifier => typeof identifier !== 'string' || !identifier) || new Set(identifiers).size !== identifiers.length) throw new NetworkError('format', '星轨 id 缺失或重复；不会自动丢弃数据。');
  const sanitized = sanitizePipelineState(candidate);
  if (sanitized.demands.some(demand => demand.activityEvents !== undefined && !validActivityEvents(demand.activityEvents))) throw new NetworkError('format', '节点时间记录无效；原草稿保留，不覆盖团队数据。');
  if (sanitized.demands.length !== candidate.demands.length) throw new NetworkError('format', '星轨数据不完整；不会自动丢弃数据。');
  assertPreserved({ ...candidate, selectedDemandId: sanitized.selectedDemandId }, sanitized);
  return sanitized;
}
export function sharedState(state: PipelineLocalState): PipelineLocalState {
  const result = validateState(state);
  return { ...result, selectedDemandId: result.demands[0].id, board: { ...result.board, currentUserId: 'team-member', revision: 0 } };
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
export function sameState(first: PipelineLocalState | null, second: PipelineLocalState | null) {
  return stableJson(first && sharedState(first)) === stableJson(second && sharedState(second));
}

export class GitLabClient {
  readonly config: RepositoryConfig;
  private treeFiles = false;
  constructor(private hostFetch: HostFetch, private credential: CredentialProvider, config: RepositoryConfig) {
    const origin = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !Number.isSafeInteger(config.projectId) || config.projectId <= 0 || !/^[a-zA-Z0-9_-][a-zA-Z0-9._/-]{0,199}$/.test(config.branch) || /\.\.|\/\/|[/.]$|\.lock$/.test(config.branch)) throw new NetworkError('format', 'GitLab 目标必须是明确的 HTTP(S) origin、项目 id 和合法分支；不会回退至 master。');
    this.config = { ...config, baseUrl: origin.origin };
  }
  get target() { return this.config.baseUrl + '/projects/' + this.config.projectId + '/' + this.config.branch; }
  private async request(endpoint: string, method = 'GET', body?: unknown, global = false): Promise<Response> {
    requireSecureRepository(this.config);
    const token = await this.credential().catch(() => null);
    if (!token) throw new NetworkError('credentials', '尚未登录或会话已失效；请在星图登录，凭据仅保留在本次会话内存。');
    const reading = method === 'GET' || method === 'HEAD';
    const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const address = this.config.baseUrl + '/api/v4' + (global ? '' : '/projects/' + this.config.projectId) + endpoint;
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    if (new TextEncoder().encode(JSON.stringify({ url: address, ...init })).byteLength > 1024 * 1024) throw new NetworkError('format', '请求超过宿主 1 MiB RPC 限制；未提交，草稿保留。请减小空间数据后重试。');
    let response: Response;
    try { response = await this.hostFetch(address, init); }
    catch { throw new NetworkError(reading ? 'network' : 'unknown', reading ? '宿主网络请求失败；本地草稿保留。' : '写入回执不明；先拉取核对，不会自动重发。'); }
    if (response.url && new URL(response.url).origin !== this.config.baseUrl) throw new NetworkError(reading ? 'forbidden' : 'unknown', '请求被重定向到其它 origin；已停止处理，请核验公司入口。写入回执须先核对，不会盲目重发。');
    if (response.status === 401) throw new NetworkError('credentials', 'GitLab 凭据无效或过期；本地草稿保留。');
    if (response.status === 403) throw new NetworkError('forbidden', 'GitLab 拒绝访问或写入；请核验团队成员、API scope 与所选分支权限；不会回退至 master。');
    if (!reading && response.status >= 500) throw new NetworkError('unknown', '服务器写入回执不明；先拉取核对，不会自动重发。');
    if (!reading && [400, 409].includes(response.status)) throw new NetworkError('conflict', '提交未获确认，可能已有并发修改；请拉取核对。');
    if (!response.ok && response.status !== 404) throw new NetworkError('http', 'GitLab 请求失败（HTTP ' + response.status + '）；请稍后手动重试。');
    return response;
  }
  private async json(response: Response): Promise<Record<string, unknown>> {
    try { const value = await response.json(); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { throw new NetworkError('format', 'GitLab 返回了无法识别的数据；不会覆盖缓存。'); }
  }
  async verifyProject() {
    const project = await this.request('');
    if (project.status === 404) throw new NetworkError('missing', '团队仓不可见或不存在；404 不能视为空仓。');
    const details = await this.json(project);
    if (details.id !== this.config.projectId) throw new NetworkError('format', '项目身份与已选团队数据仓不符；已停止。');
  }
  async branchExists(branch = this.config.branch) {
    const response = await this.request('/repository/branches/' + encodeURIComponent(branch));
    if (response.status === 404) return false;
    const details = await this.json(response);
    if (details.name !== branch) throw new NetworkError('format', 'GitLab 返回的分支身份不符；不会连接其它分支。');
    return true;
  }
  async verifyAccess() {
    await this.verifyProject();
    if (!await this.branchExists()) throw new NetworkError('missing-branch', '所选分支不存在或不可见；不会回退至 master。请在 GitLab 核验分支后重新登录。');
  }
  private requireWritableRepository() {
    if (new URL(this.config.baseUrl).hostname === new URL(AUTHORIZED_HTTP_ORIGIN).hostname && this.config.branch === 'master') throw new NetworkError('forbidden', '公司 master 仅可读取；请显式选择有权写入的协作分支。');
  }
  async identity() {
    const user = await this.json(await this.request('/user', 'GET', undefined, true));
    if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0 || typeof user.username !== 'string' || !user.username) throw new NetworkError('format', 'GitLab 未返回可核验的账号身份；未进入团队空间。');
    return { id: Number(user.id), name: user.username.slice(0, 120) };
  }
  async revision(space: string): Promise<string | null> {
    if (this.treeFiles) {
      const file = await this.treeFile(space, false, this.config.branch, false);
      if (!file) { await this.verifyAccess(); return null; }
      return file.last_commit_id as string;
    }
    const response = await this.request('/repository/files/' + encodeURIComponent(this.filePath(space)) + '?ref=' + encodeURIComponent(this.config.branch), 'HEAD');
    if (response.status === 404) {
      const file = await this.treeFile(space, false, this.config.branch, false);
      if (file) return file.last_commit_id as string;
      await this.verifyAccess(); return null;
    }
    const revision = response.headers.get('x-gitlab-last-commit-id');
    if (!revision) throw new NetworkError('format', 'GitLab HEAD 缺少文件版本，已停止自动轮询；可手动拉取核验。');
    return revision;
  }
  private filePath(space: string, meta = false) { return 'spaces/' + validateSpaceName(space) + (meta ? '.meta.json' : '.json'); }
  private async file(space: string, meta = false, ref = this.config.branch) {
    if (this.treeFiles) return this.treeFile(space, meta, ref);
    const response = await this.request('/repository/files/' + encodeURIComponent(this.filePath(space, meta)) + '?ref=' + encodeURIComponent(ref));
    return response.status === 404 ? meta ? null : this.treeFile(space, meta, ref) : this.json(response);
  }
  private async treeFile(space: string, meta: boolean, ref: string, content = true): Promise<Record<string, unknown> | null> {
    const filePath = this.filePath(space, meta), name = filePath.slice('spaces/'.length);
    const entryAt = async (revision: string): Promise<Record<string, unknown> | null> => {
      let page = '1';
      const visited = new Set<string>();
      while (page) {
        if (visited.has(page)) throw new NetworkError('format', '文件目录分页重复；不会推测缺失文件。');
        visited.add(page);
        const response = await this.request('/repository/tree?ref=' + encodeURIComponent(revision) + '&path=spaces&per_page=100&page=' + encodeURIComponent(page));
        if (response.status === 404) return null;
        let entries: unknown;
        try { entries = await response.json(); } catch { throw new NetworkError('format', '文件目录无法解析。'); }
        if (!Array.isArray(entries)) throw new NetworkError('format', '文件目录格式无效。');
        const entry = entries.find(item => item?.name === name);
        if (entry) {
          if (entry.type !== 'blob' || typeof entry.id !== 'string' || !/^[a-f0-9]{40,64}$/.test(entry.id) || entry.path !== filePath) throw new NetworkError('format', '目录文件身份不符；不会读取或覆盖其它文件。');
          return entry;
        }
        page = response.headers.get('x-next-page') || '';
      }
      return null;
    };
    let entry = await entryAt(ref);
    if (!entry) return null;
    let snapshot = ref;
    if (ref === this.config.branch) {
      const branchResponse = await this.request('/repository/branches/' + encodeURIComponent(this.config.branch));
      if (branchResponse.status === 404) throw new NetworkError('missing-branch', '所选分支不可见；不会回退 master。');
      const branch = await this.json(branchResponse), commit = branch.commit as Record<string, unknown> | undefined;
      if (branch.name !== this.config.branch || typeof commit?.id !== 'string' || !/^[a-f0-9]{40,64}$/.test(commit.id)) throw new NetworkError('format', '所选分支缺少可核验快照。');
      snapshot = commit.id;
      entry = await entryAt(snapshot);
      if (!entry) return null;
    }
    const historyResponse = await this.request('/repository/commits?ref_name=' + encodeURIComponent(snapshot) + '&path=' + encodeURIComponent(filePath) + '&per_page=1');
    let history: unknown;
    try { history = await historyResponse.json(); } catch { throw new NetworkError('format', '文件提交版本无法解析。'); }
    if (!Array.isArray(history) || typeof history[0]?.id !== 'string' || !/^[a-f0-9]{40,64}$/.test(history[0].id)) throw new NetworkError('format', '文件缺少可核验的最后提交版本；禁止写入。');
    const versions = { last_commit_id: history[0].id, commit_id: snapshot };
    if (!content) { this.treeFiles = true; return versions; }
    const blobResponse = await this.request('/repository/blobs/' + entry.id);
    if (blobResponse.status === 404) throw new NetworkError('format', '已核验快照的文件内容不可见；不能当作空空间。');
    const blob = await this.json(blobResponse);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new NetworkError('format', '文件内容编码无效。');
    this.treeFiles = true;
    return { ...blob, ...versions };
  }
  async load(space: string): Promise<RemoteSpace> {
    validateSpaceName(space);
    const file = await this.file(space);
    if (!file) { await this.verifyAccess(); return { state: null, rev: null, metaRev: null }; }
    if (typeof file.last_commit_id !== 'string' || typeof file.commit_id !== 'string' || typeof file.content !== 'string' || file.encoding !== 'base64') throw new NetworkError('format', 'GitLab 文件缺少内容或提交版本。');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(file.content.replace(/\s/g, '')), character => character.charCodeAt(0)))); }
    catch { throw new NetworkError('format', '远端 JSON 或 UTF-8 无效；本地数据保留。'); }
    const state = validateState(value);
    const meta = await this.file(space, true, file.commit_id);
    if (meta && typeof meta.last_commit_id !== 'string') throw new NetworkError('format', '空间元信息缺少提交版本。');
    return { state, rev: file.last_commit_id, metaRev: meta ? meta.last_commit_id as string : null };
  }
  async listSpaces(): Promise<string[]> {
    const names = new Set<string>(), visited = new Set<string>();
    let page = '1';
    while (page) {
      if (visited.has(page)) throw new NetworkError('format', 'GitLab 分页游标重复。');
      visited.add(page);
      const response = await this.request('/repository/tree?ref=' + encodeURIComponent(this.config.branch) + '&path=spaces&per_page=100&page=' + encodeURIComponent(page));
      if (response.status === 404) { await this.verifyAccess(); break; }
      let entries: unknown;
      try { entries = await response.json(); } catch { throw new NetworkError('format', '空间目录不可解析。'); }
      if (!Array.isArray(entries)) throw new NetworkError('format', '空间目录格式无效。');
      for (const entry of entries) if (entry?.type === 'blob' && typeof entry.name === 'string' && /^[a-zA-Z0-9_-]{1,80}\.json$/.test(entry.name)) names.add(entry.name.slice(0, -5));
      page = response.headers.get('x-next-page') || '';
    }
    return [...names].sort();
  }
  async save(space: string, state: PipelineLocalState, baseRev: string | null, actor: string): Promise<RemoteSpace> {
    requireSecureRepository(this.config);
    this.requireWritableRepository();
    const clean = sharedState(state), current = await this.load(space);
    if (current.rev !== baseRev) throw new NetworkError('conflict', '远端版本已经变化；不会覆盖他人的修改。');
    if (sameState(clean, current.state)) return current;
    const metadata = { updated_at: new Date().toISOString(), updated_by: actor.slice(0, 120), previous_rev: baseRev };
    const action = (meta: boolean, content: unknown, revision: string | null) => ({ action: revision ? 'update' : 'create', file_path: this.filePath(space, meta), content: JSON.stringify(content, null, 2) + '\n', ...(revision ? { last_commit_id: revision } : {}) });
    const response = await this.request('/repository/commits', 'POST', { branch: this.config.branch, commit_message: 'Starmap: update space ' + space, actions: [action(false, clean, current.rev), action(true, metadata, current.metaRev)] });
    if (response.status === 404) throw new NetworkError('missing', '提交目标不可见；本地草稿保留。');
    let result: Record<string, unknown>;
    try { result = await this.json(response); } catch { throw new NetworkError('unknown', '写入响应无法解析；先拉取核对。'); }
    if (typeof result.id !== 'string' || !result.id) throw new NetworkError('unknown', '写入未返回提交 id；先拉取核对。');
    return { state: clean, rev: result.id, metaRev: result.id };
  }
}
