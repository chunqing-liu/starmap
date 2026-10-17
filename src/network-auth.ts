import { GitLabClient, NetworkError, requireSecureRepository, validateSpaceName, type HostFetch, type RepositoryConfig } from './gitlab-client';
import { createTeamStorage } from './storage';
import { TeamSync, type LocalCache } from './sync';
import type { PipelineLocalState } from './models/schema';

export class SessionLogin {
  #grant: { token: string } | null = null;
  private sequence = 0;
  private current: TeamSync | null = null;
  private config: RepositoryConfig | null = null;
  private user: { id: number; name: string } | null = null;
  constructor(private hostFetch: HostFetch, private cache: LocalCache, private fresh: () => PipelineLocalState, private allowed?: RepositoryConfig) {}
  snapshot() { return { user: this.user, connected: Boolean(this.current), target: this.config?.baseUrl || null, projectId: this.config?.projectId || null, branch: this.config?.branch || '' }; }
  disconnect() {
    this.sequence++;
    if (this.#grant) this.#grant.token = '';
    this.#grant = null; this.current?.dispose(); this.current = null; this.config = null; this.user = null;
  }
  async connect(token: string, baseUrl: string, space: string, branch = this.allowed?.branch || '', projectId = this.allowed?.projectId || 0) {
    const config = { baseUrl, branch, projectId };
    new GitLabClient(this.hostFetch, async () => null, config);
    requireSecureRepository(config);
    config.baseUrl = new URL(config.baseUrl).origin;
    if (this.allowed && new URL(baseUrl).origin !== new URL(this.allowed.baseUrl).origin) throw new NetworkError('forbidden', '只能连接已选精确 GitLab origin；不会换用其它端口或代理入口。');
    validateSpaceName(space);
    if (!token.trim() || /\s/.test(token.trim())) throw new NetworkError('credentials', '请输入有效的访问令牌；不记录输入内容。');
    await this.current?.checkpoint();
    this.disconnect();
    const sequence = this.sequence, grant = { token: token.trim() };
    this.#grant = grant;
    const credentials = async () => this.#grant === grant ? grant.token : null;
    try {
      const client = new GitLabClient(this.hostFetch, credentials, config);
      const user = await client.identity(); await client.verifyProject();
      const exists = await client.branchExists();
      if (sequence !== this.sequence) throw new NetworkError('credentials', '登录已取消，请重新登录。');
      this.config = client.config; this.user = user;
      if (!exists) throw new NetworkError('missing-branch', '所选分支不存在或不可见；不会创建、重置分支，也不会回退 master。');
      this.current = new TeamSync(createTeamStorage(this.hostFetch, credentials, client.config), this.cache, space, this.fresh(), String(user.id), true);
      return this.current;
    } catch (error) {
      grant.token = '';
      if (sequence === this.sequence) this.disconnect();
      throw error instanceof NetworkError ? error : new NetworkError('credentials', '登录未完成；未保存凭据，请核验公司入口和账号权限。');
    }
  }
  async switchSpace(space: string) {
    if (!this.current || !this.config || !this.user || !this.#grant) throw new NetworkError('credentials', '请先登录。');
    validateSpaceName(space);
    const previous = this.current, grant = this.#grant;
    if (space === previous.space) return previous;
    await previous.checkpoint();
    if (this.current !== previous || this.#grant !== grant) throw new NetworkError('credentials', '会话已变更，请重新选择共享空间。');
    const next = new TeamSync(createTeamStorage(this.hostFetch, async () => this.#grant === grant ? grant.token : null, this.config), this.cache, space, this.fresh(), String(this.user.id), true);
    previous.dispose(); this.current = next;
    return this.current;
  }
}
