import { useEffect, useRef, useState } from 'react';
import { pluginConfirm, pluginStorage, setPluginAccountScope } from './host';
import { networkLogin, networkSession } from './network-session';
import { AutoSync, browserSyncEnvironment } from './auto-sync';
import { TeamSync, type SyncStatus } from './sync';
import { NetworkError, validateSpaceName } from './gitlab-client';
import type { PipelineLocalState } from './models/schema';
import type { ConflictChoices } from './sync-merge';
import { parseSharedConnection, serializeSharedConnection, type SharedConnection } from './shared-connection';
import { TeamSpacePicker } from './team-space-picker';

const liteTeam = { label: 'Lite 项目组', endpoint: 'http://newgit.d5techs.com.cn', projectId: '724', branch: 'lite', space: 'lite' };
const teamName = (space: string) => (space === liteTeam.space ? liteTeam.label : space || liteTeam.label);
const labels: Record<SyncStatus, string> = { local: '本地草稿', dirty: '等待自动上传', synced: '已同步', syncing: '同步中', offline: '离线待传', conflict: '冲突', unknown: '写入待核验', error: '同步未完成' };
export function NetworkSyncBar({ sync, onStateLoaded, onSessionChanged }: { sync: TeamSync; onStateLoaded(state: PipelineLocalState): void; onSessionChanged(sync: TeamSync): void }) {
  const [snapshot, setSnapshot] = useState(() => sync.snapshot());
  const [open, setOpen] = useState(false), [space, setSpace] = useState(sync.space || liteTeam.space);
  const [choices, setChoices] = useState<ConflictChoices>({}), [error, setError] = useState(''), [loggingIn, setLoggingIn] = useState(false);
  const [interval, setIntervalSeconds] = useState(5), [endpoint, setEndpoint] = useState(liteTeam.endpoint);
  const [projectId, setProjectId] = useState(liteTeam.projectId), [branch, setBranch] = useState(liteTeam.branch);
  const [shareOpen, setShareOpen] = useState(false), [shareText, setShareText] = useState(''), [shareStatus, setShareStatus] = useState('');
  const [joinOpen, setJoinOpen] = useState(false), [joinText, setJoinText] = useState(''), [joinPreview, setJoinPreview] = useState<SharedConnection | null>(null), [joinError, setJoinError] = useState(''), [joinStatus, setJoinStatus] = useState('');
  const tokenInput = useRef<HTMLInputElement>(null), automatic = useRef<AutoSync | null>(null);
  const loaded = useRef(onStateLoaded); loaded.current = onStateLoaded;
  const account = networkLogin.snapshot(), connected = account.connected && Boolean(sync.account);
  useEffect(() => {
    let applied = sync.snapshot().applied, conflictKey = '';
    setSnapshot(sync.snapshot()); setSpace(sync.space); setChoices({}); setError('');
    return sync.subscribe(() => {
      const next = sync.snapshot(); setSnapshot(next);
      const key = JSON.stringify([next.conflicts, next.base?.rev]);
      if (key !== conflictKey) { conflictKey = key; setChoices({}); }
      if (next.applied !== applied) { applied = next.applied; loaded.current(next.draft); }
    });
  }, [sync]);
  useEffect(() => {
    if (!connected) return;
    const controller = new AutoSync(sync, 'GitLab ' + account.user!.name, browserSyncEnvironment(), interval * 1000);
    automatic.current = controller; controller.start();
    return () => { controller.stop(); automatic.current = null; };
  }, [sync, connected, interval]);
  useEffect(() => {
    const hide = () => automatic.current?.stop();
    const show = () => automatic.current?.start();
    const unload = () => { automatic.current?.stop(); networkLogin.disconnect(); };
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    const stop = window.grove.onUnload?.(unload);
    return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); stop?.(); };
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    setError('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof NetworkError ? failure.message : '操作未完成；请核验公司入口、账号权限和本机存储。'); }
  };
  function activate(next: TeamSync) {
    automatic.current?.stop();
    setPluginAccountScope(next.account ? next.remote.target + ':' + next.account : '');
    onSessionChanged(next);
  }
  async function login() {
    const token = tokenInput.current?.value || '';
    if (tokenInput.current) tokenInput.current.value = '';
    validateSpaceName(space); setLoggingIn(true); automatic.current?.stop();
    try { const next = await networkLogin.connect(token, endpoint, space, branch, Number(projectId)); if (next) { activate(next); setOpen(false); } }
    finally { setLoggingIn(false); }
  }
  async function logout() {
    await sync.checkpoint(); automatic.current?.stop(); networkLogin.disconnect(); setPluginAccountScope(''); activate(networkSession());
  }
  async function push() {
    const creating = snapshot.base?.state === null;
    if (creating && !await pluginConfirm('将此账号草稿首次写入团队空间「' + sync.space + '」？只应选择已获准写入的空间，不会迁移其它账号或离线草稿。')) return;
    await sync.push('GitLab ' + account.user?.name, creating); automatic.current?.wake();
  }
  function openShare() {
    if (!account.target || !account.projectId || !account.branch) { setShareStatus('当前连接缺少可核验目标，未生成分享信息。'); return; }
    try { setShareText(serializeSharedConnection({ baseUrl: account.target, projectId: account.projectId, branch: account.branch }, sync.space)); setShareStatus(''); setShareOpen(true); }
    catch (failure) { setShareStatus(failure instanceof NetworkError ? failure.message : '连接信息生成失败；当前空间和草稿保留。'); }
  }
  async function copyShare() {
    try { await navigator.clipboard.writeText(shareText); setShareStatus('已复制，发给团队成员即可。'); }
    catch { setShareStatus('当前宿主不允许自动复制，请手动选择文本；未发起网络请求。'); }
  }
  function previewJoin() {
    setJoinPreview(null); setJoinError(''); setJoinStatus('');
    try { setJoinPreview(parseSharedConnection(joinText)); }
    catch (failure) { setJoinError(failure instanceof NetworkError ? failure.message : '连接信息校验失败；当前草稿保留。'); }
  }
  function confirmJoin() {
    if (!joinPreview) return;
    setEndpoint(joinPreview.baseUrl); setProjectId(String(joinPreview.projectId)); setBranch(joinPreview.branch); setSpace(joinPreview.space);
    setJoinOpen(false); setJoinError(''); setJoinStatus('目标已确认，用你自己的令牌登录即可。'); setOpen(true);
    requestAnimationFrame(() => tokenInput.current?.focus());
  }
  return <section className={'pipeline-network-sync is-' + snapshot.status} aria-label="团队联网同步">
    <div className="pipeline-network-summary">
      <strong role="status">{connected ? labels[snapshot.status] + ' · ' + teamName(sync.space) : teamName(sync.space) + ' · 未连接'}</strong>
      <span>{connected ? account.user?.name + ' · 每 ' + interval + ' 秒自动核对' : '输入一次访问令牌即可加入，其它都已设好。'}</span>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{connected ? '联网设置' : '登录 / 联网设置'}</button>
      {connected && <button type="button" disabled={snapshot.busy} onClick={() => void run(async () => { await sync.pull(); automatic.current?.wake(); })}>刷新团队星轨</button>}
      {connected && <button type="button" onClick={() => shareOpen ? setShareOpen(false) : openShare()}>{shareOpen ? '收起连接信息' : '分享团队空间信息'}</button>}
      {(open || connected && snapshot.base?.state === null) && <button type="button" disabled={!connected || snapshot.busy || !snapshot.base || !snapshot.dirty || Boolean(snapshot.pending) || snapshot.status === 'conflict'} onClick={() => void run(push)}>{snapshot.base?.state === null ? '确认首次写入' : '立即同步草稿'}</button>}
    </div>
    {shareOpen && connected && <div className="pipeline-network-share" role="region" aria-label="分享团队空间信息">
      <p>只含项目、分支和空间，不含令牌，只发给自己人。</p>
      <textarea aria-label="团队空间连接信息（分享）" readOnly value={shareText} onFocus={event => event.currentTarget.select()} />
      <button type="button" onClick={() => void copyShare()}>复制连接信息</button>
      {shareStatus && <p role="status">{shareStatus}</p>}
    </div>}
    {connected && <>
      <p className="pipeline-network-target">{account.target} · 分支 {account.branch}；{snapshot.base?.state ? '同一围炉成员连上后自动看到彼此改动。' : '首次写入还没确认，新星轨先留在本机。'}</p>
      <TeamSpacePicker sync={sync} onSelect={async name => activate(await networkLogin.switchSpace(name))} />
    </>}
    {(open || connected) && (connected ? account.target : endpoint)?.startsWith('http:') && <p className="pipeline-network-warning" role="note">公司仓走 HTTP 未加密，只在公司网络里用。</p>}
    {(open || connected || snapshot.storageFailed) && snapshot.dirty && <p className="pipeline-network-warning" role="status">{snapshot.storageFailed ? '本机保存失败，关闭页面可能丢失。' : connected ? '改动先存本机，随后自动上传；冲突不会互相覆盖。' : '连接前只存本机，不会上传旧草稿。'}</p>}
    {connected && (snapshot.status === 'error' || snapshot.status === 'offline' || snapshot.status === 'conflict' || snapshot.status === 'unknown') && <p role="status">{snapshot.message}</p>}
    {snapshot.storageFailed && <p className="pipeline-network-warning" role="alert"><button type="button" disabled={snapshot.busy} onClick={() => void run(async () => { await sync.checkpoint(); automatic.current?.wake(); })}>重试本机保存</button> 先确认本机保存成功，再恢复团队同步；不会绕过存储权限。</p>}
    {open && <div className="pipeline-network-settings" role="region" aria-label="登录与自动同步设置">
      <strong>{liteTeam.label}</strong>
      {!connected ? <div role="form" aria-label="团队登录" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !loggingIn) { event.preventDefault(); void run(login); } }}>
        <p>粘贴自己的访问令牌，点连接。服务器、项目、分支和空间都已经设好，不用填。</p>
        <label>访问令牌<input ref={tokenInput} aria-label="GitLab 访问令牌" type="password" autoComplete="off" spellCheck={false} required /></label>
        <button type="button" disabled={loggingIn} onClick={() => void run(login)}>{loggingIn ? '正在核对…' : '连接'}</button>
        <p role="note">令牌只在这次打开期间有效，关掉重开要再输一次。</p>
      </div> : <div>
        <p>已连接：{account.user?.name} · {teamName(sync.space)}。换账号先退出。</p>
        <button type="button" disabled={loggingIn} onClick={() => void run(logout)}>退出账号</button>
      </div>}
      <details className="pipeline-network-advanced">
        <summary>高级设置</summary>
        <label>公司 GitLab 入口<input aria-label="GitLab 入口" type="url" required value={endpoint} onChange={event => setEndpoint(event.target.value)} /></label>
        <label>项目 ID<input aria-label="GitLab 项目 ID" type="number" min="1" required value={projectId} onChange={event => setProjectId(event.target.value)} /></label>
        <label>目标分支<input aria-label="GitLab 目标分支" required value={branch} onChange={event => setBranch(event.target.value)} /></label>
        <label>空间标识<input aria-label="联网空间标识" value={space} maxLength={80} onChange={event => setSpace(event.target.value)} /></label>
        {!connected && <button type="button" disabled={loggingIn} onClick={() => void run(login)}>仅本次会话登录</button>}
        {connected && <button type="button" disabled={snapshot.busy} onClick={() => void run(async () => { validateSpaceName(space); activate(await networkLogin.switchSpace(space)); })}>切换联网空间</button>}
        <label>核对间隔<select aria-label="自动同步检查间隔" value={interval} onChange={event => setIntervalSeconds(Number(event.target.value))}><option value={3}>3 秒</option><option value={5}>5 秒（默认）</option><option value={10}>10 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option></select></label>
        {!connected && <button type="button" onClick={() => { setJoinOpen(!joinOpen); setJoinPreview(null); setJoinError(''); setJoinStatus(''); }}>{joinOpen ? '收起加入入口' : '加入别的团队空间'}</button>}
        {!connected && joinOpen && <div className="pipeline-network-join" role="region" aria-label="加入已有团队空间">
          <p>粘贴对方给的连接信息，确认后再用自己的令牌登录。</p>
          <label>团队空间连接信息<textarea aria-label="团队空间连接信息" value={joinText} onChange={event => { setJoinText(event.target.value); setJoinPreview(null); setJoinError(''); setJoinStatus(''); }} /></label>
          <button type="button" disabled={!joinText.trim()} onClick={previewJoin}>校验并预览</button>
          {joinError && <p role="alert">{joinError}</p>}
          {joinPreview && <div className="pipeline-network-join-preview" role="region" aria-label="加入目标预览">
            <strong>将加入以下目标</strong>
            <dl><dt>入口</dt><dd>{joinPreview.baseUrl}</dd><dt>项目</dt><dd>{joinPreview.projectId}</dd><dt>分支</dt><dd>{joinPreview.branch}</dd><dt>空间</dt><dd>{joinPreview.space}</dd></dl>
            <button type="button" onClick={confirmJoin}>确认并用本人账号登录</button>
          </div>}
          {joinStatus && <p role="status">{joinStatus}</p>}
        </div>}
        <p role="note">公司 master 只读，团队数据走 lite 分支。</p>
      </details>
      <p>上次核对：{snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString() : '尚未核对'}</p>
    </div>}
    {snapshot.conflicts.length > 0 && <div className="pipeline-network-conflicts" role="region" aria-label="联网字段冲突">
      <h4>双方都修改的字段（{snapshot.conflicts.length}）</h4>
      {snapshot.conflicts.map(conflict => <label key={conflict.path}><code>{conflict.path}</code>
        <details><summary>查看两端内容</summary><pre>本地：{conflict.localDeleted ? '已删除' : JSON.stringify(conflict.local, null, 2)}{'\n'}远端：{conflict.remoteDeleted ? '已删除' : JSON.stringify(conflict.remote, null, 2)}</pre></details>
        <select aria-label={'冲突选择 ' + conflict.path} value={choices[conflict.path] || ''} onChange={event => setChoices({ ...choices, [conflict.path]: event.target.value as 'local' | 'remote' })}><option value="">请选择，不会自动覆盖</option><option value="local">保留此字段的本地修改</option><option value="remote">采纳此字段的远端修改</option></select>
      </label>)}
      <button type="button" disabled={snapshot.busy || snapshot.conflicts.some(conflict => !choices[conflict.path])} onClick={() => void run(async () => { await sync.resolve(choices); automatic.current?.wake(); })}>应用冲突选择</button>
      <p>选择后自动同步；提交前仍核验远端版本，再有同处修改会再次提示。</p>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
