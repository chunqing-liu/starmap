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

const labels: Record<SyncStatus, string> = { local: '本地草稿', dirty: '等待自动上传', synced: '已同步', syncing: '同步中', offline: '离线待传', conflict: '冲突', unknown: '写入待核验', error: '同步未完成' };
export function NetworkSyncBar({ sync, onStateLoaded, onSessionChanged }: { sync: TeamSync; onStateLoaded(state: PipelineLocalState): void; onSessionChanged(sync: TeamSync): void }) {
  const [snapshot, setSnapshot] = useState(() => sync.snapshot());
  const [open, setOpen] = useState(false), [space, setSpace] = useState(sync.space);
  const [choices, setChoices] = useState<ConflictChoices>({}), [error, setError] = useState(''), [loggingIn, setLoggingIn] = useState(false);
  const [interval, setIntervalSeconds] = useState(5), [endpoint, setEndpoint] = useState('');
  const [projectId, setProjectId] = useState(''), [branch, setBranch] = useState('');
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
    try { await navigator.clipboard.writeText(shareText); setShareStatus('已复制非秘密连接信息；请仅发送给已获授权成员。'); }
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
    setJoinOpen(false); setJoinError(''); setJoinStatus('目标已确认；请使用你自己的 GitLab 访问令牌登录。当前本机草稿未改动。'); setOpen(true);
    requestAnimationFrame(() => tokenInput.current?.focus());
  }
  return <section className={'pipeline-network-sync is-' + snapshot.status} aria-label="团队联网同步">
    <div className="pipeline-network-summary">
      <strong role="status">{connected ? labels[snapshot.status] : '未登录 · 联网不可用'} · {sync.space}</strong>
      <span>{connected ? account.user?.name + ' · 前台每 ' + interval + ' 秒检查' : '本机草稿可继续编辑；按需登录团队协作。'}</span>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{connected ? '联网设置' : '登录 / 联网设置'}</button>
      {connected && <button type="button" disabled={snapshot.busy} onClick={() => void run(async () => { await sync.pull(); automatic.current?.wake(); })}>刷新团队星轨</button>}
      {connected && <button type="button" onClick={() => shareOpen ? setShareOpen(false) : openShare()}>{shareOpen ? '收起连接信息' : '分享团队空间信息'}</button>}
      {(open || connected && snapshot.base?.state === null) && <button type="button" disabled={!connected || snapshot.busy || !snapshot.base || !snapshot.dirty || Boolean(snapshot.pending) || snapshot.status === 'conflict'} onClick={() => void run(push)}>{snapshot.base?.state === null ? '确认首次写入' : '立即同步草稿'}</button>}
    </div>
    {shareOpen && connected && <div className="pipeline-network-share" role="region" aria-label="分享团队空间信息">
      <p>以下仅包含 GitLab origin、项目、分支和空间，不含访问令牌、账号或星轨正文。项目地址可能属于内部数据，仅供已获授权成员使用；不要上传公共服务。</p>
      <textarea aria-label="团队空间连接信息（分享）" readOnly value={shareText} onFocus={event => event.currentTarget.select()} />
      <button type="button" onClick={() => void copyShare()}>复制连接信息</button>
      {shareStatus && <p role="status">{shareStatus}</p>}
    </div>}
    {connected && <>
      <p className="pipeline-network-target">{account.target} · 项目 {account.projectId} · 分支 {account.branch} · 当前空间 {sync.space}；{snapshot.base?.state ? '此空间内新建的星轨会自动同步，其他实例连接同一项目、分支和空间后可刷新或等待自动同步。' : '当前空间尚未核验或首次写入未确认，新建星轨先保留在本机。'}</p>
      <TeamSpacePicker sync={sync} onSelect={async name => activate(await networkLogin.switchSpace(name))} />
    </>}
    {(open || connected) && (connected ? account.target : endpoint)?.startsWith('http:') && <p className="pipeline-network-warning" role="note">公司仓 HTTP 未加密：凭据与团队内容在传输途中可能被读取或篡改。仅此精确 origin 已获准，不代表安全加密连接。</p>}
    {(open || connected || snapshot.storageFailed) && snapshot.dirty && <p className="pipeline-network-warning" role="status">{snapshot.storageFailed ? '本机保存失败，关闭页面可能丢失。' : connected ? '本地改动暂存本机；前台短暂合并后自动上传，冲突不覆盖，隐藏页面暂停。' : '尚未同步到团队；登录前仅保存本机草稿，不会自动上传旧离线数据。'}</p>}
    {connected && (snapshot.status === 'error' || snapshot.status === 'offline' || snapshot.status === 'conflict' || snapshot.status === 'unknown') && <p role="status">{snapshot.message}</p>}
    {snapshot.storageFailed && <p className="pipeline-network-warning" role="alert"><button type="button" disabled={snapshot.busy} onClick={() => void run(async () => { await sync.checkpoint(); automatic.current?.wake(); })}>重试本机保存</button> 先确认本机保存成功，再恢复团队同步；不会绕过存储权限。</p>}
    {open && <div className="pipeline-network-settings" role="region" aria-label="登录与自动同步设置">
      <p>选择有权限的 GitLab 项目、已存在分支与空间；所有请求只经 grove.network.fetch。</p>
      <p role="note">仅本次会话内存凭据模式：SDK 1.5 没有公开安全凭据持久化接口。关闭 / 重开需重登，不写普通存储、团队仓、URL 或日志。</p>
      {!connected && <button type="button" onClick={() => { setJoinOpen(!joinOpen); setJoinPreview(null); setJoinError(''); setJoinStatus(''); }}>{joinOpen ? '收起加入入口' : '加入已有团队空间'}</button>}
      {!connected && joinOpen && <div className="pipeline-network-join" role="region" aria-label="加入已有团队空间">
        <p>粘贴已获授权成员提供的连接信息。这里仅校验和预览目标，不访问网络、不接收令牌；确认后仍需使用你自己的 GitLab 账号登录。</p>
        <label>团队空间连接信息<textarea aria-label="团队空间连接信息" value={joinText} onChange={event => { setJoinText(event.target.value); setJoinPreview(null); setJoinError(''); setJoinStatus(''); }} /></label>
        <button type="button" disabled={!joinText.trim()} onClick={previewJoin}>校验并预览</button>
        {joinError && <p role="alert">{joinError}</p>}
        {joinPreview && <div className="pipeline-network-join-preview" role="region" aria-label="加入目标预览">
          <strong>将加入以下目标</strong>
          <dl><dt>GitLab origin</dt><dd>{joinPreview.baseUrl}</dd><dt>项目</dt><dd>{joinPreview.projectId}</dd><dt>分支</dt><dd>{joinPreview.branch}</dd><dt>空间</dt><dd>{joinPreview.space}</dd></dl>
          <p>确认不会覆盖当前本机草稿；接下来只填入你自己的访问令牌并重新核验账号、项目和分支。</p>
          <button type="button" onClick={confirmJoin}>确认目标并用本人账号登录</button>
        </div>}
        {joinStatus && <p role="status">{joinStatus}</p>}
      </div>}
      {!connected ? <div className="pipeline-network-login" role="form" aria-label="GitLab 会话登录" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !loggingIn) { event.preventDefault(); void run(login); } }}>
        <label>公司 GitLab 入口<input aria-label="GitLab 入口" type="url" required value={endpoint} onChange={event => setEndpoint(event.target.value)} /></label>
        <label>项目 ID<input aria-label="GitLab 项目 ID" type="number" min="1" required value={projectId} onChange={event => setProjectId(event.target.value)} /></label>
        <label>目标分支<input aria-label="GitLab 目标分支" required value={branch} onChange={event => setBranch(event.target.value)} /></label>
        <label>访问令牌<input ref={tokenInput} aria-label="GitLab 访问令牌" type="password" autoComplete="off" spellCheck={false} required /></label>
        <label>空间标识<input aria-label="联网空间标识" value={space} maxLength={80} onChange={event => setSpace(event.target.value)} /></label>
        <button type="button" disabled={loggingIn} onClick={() => void run(login)}>{loggingIn ? '只读核验账号与仓库…' : '仅本次会话登录'}</button>
        <p>已允许指定公司 origin 的 HTTP 登录；其它 HTTP 地址仍禁止。不修改宿主、代理、TLS 或 CSP。只读登录核验不会写入，不重复弹出 HTTP 确认。</p>
      </div> : <>
        <p>账号 {account.user?.name} · {account.target} · 项目 {account.projectId} · {account.branch}；更换账号前退出，草稿按仓库 / 空间 / 账号隔离。</p>
        <button type="button" disabled={loggingIn} onClick={() => void run(logout)}>退出账号</button>
        <label>空间标识<input aria-label="联网空间标识" value={space} maxLength={80} onChange={event => setSpace(event.target.value)} /></label>
        <button type="button" disabled={snapshot.busy} onClick={() => void run(async () => { validateSpaceName(space); activate(await networkLogin.switchSpace(space)); })}>切换联网空间</button>
      </>}
      <label>前台检查间隔<select aria-label="自动同步检查间隔" value={interval} onChange={event => setIntervalSeconds(Number(event.target.value))}><option value={3}>3 秒</option><option value={5}>5 秒（默认）</option><option value={10}>10 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option></select></label>
      <p>秒级自动更新，不是即时推送。编辑合并 800ms；检查版本变化才拉取正文；重连 / 激活立即检查；失败指数退避最长 60 秒，凭据或权限失败暂停。</p>
      <p>上次核验：{snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString() : '尚未核验'}；版本：{snapshot.base?.rev || '无远端版本'}。</p>
      <p>旧本机数据不会自动迁移。默认不连接任何仓库，不创建或重置分支；公司 master 只读。首次创建空间须手动确认，之后编辑自动上传。催办仅模拟，不外发。</p>
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
