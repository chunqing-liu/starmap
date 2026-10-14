import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pluginStorage, pluginToast } from './host';
import type { PipelineLocalState } from './models/schema';
import { loadPipelineState } from './models/templates';
import {
  applyTeamImport, createTeamExport, downloadTeamExport, parseTeamPackage,
  readImportBackup, readTeamSpaces, restoreImportBackup, switchTeamSpace,
  type ImportChoice, type ImportReport, type ParsedTeam,
} from './team-sync';

declare const __STARMAP_VERSION__: string;
function SyncDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="pipeline-team-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h3>{title}</h3>{children}
  </dialog>;
}
const choiceLabels: Record<ImportChoice, string> = { keep: '保留本地', replace: '使用导入', merge: '合并' };
export function TeamSyncSettings({ onStateLoaded }: { onStateLoaded(state: PipelineLocalState): void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [team, setTeam] = useState<ParsedTeam | null>(null), [report, setReport] = useState<ImportReport | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [backup, setBackup] = useState<ReturnType<typeof readImportBackup> | null>(null);
  const [spaceNames, setSpaceNames] = useState<string[]>([]), [activeSpace, setActiveSpace] = useState('');
  function refreshSpaces() {
    const collection = readTeamSpaces(pluginStorage);
    setSpaceNames(Object.keys(collection.spaces)); setActiveSpace(collection.activeSpace);
  }
  useEffect(() => { try { refreshSpaces(); } catch {} }, []);
  const showError = (value: unknown) => { const message = value instanceof Error ? value.message : String(value); setError(message); pluginToast(message); };
  async function chooseFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const parsed = parseTeamPackage(await file.text());
      const local = readTeamSpaces(pluginStorage);
      setChoices(Object.fromEntries(Object.keys(parsed.spaces).map(name => [name, local.spaces[name] ? 'keep' : 'replace'])));
      setTeam(parsed);
    } catch (value) { showError(value); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function apply() {
    if (!team || busy) return;
    setBusy(true); setError('');
    try {
      const result = await applyTeamImport(pluginStorage, team, choices);
      if (result.applied) { onStateLoaded(result.collection.spaces[result.collection.activeSpace].state); refreshSpaces(); }
      setTeam(null); setReport(result.report);
      pluginToast('导入完成：新增 ' + result.report.added + '、覆盖 ' + result.report.replaced + '、合并 ' + result.report.merged + '、剔除 ' + result.report.rejected.length + ' 个空间');
    } catch (value) { showError(value); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const collection = await restoreImportBackup(pluginStorage);
      onStateLoaded(collection.spaces[collection.activeSpace]?.state || loadPipelineState());
      refreshSpaces(); setBackup(null); pluginToast('已恢复导入前备份');
    } catch (value) { showError(value); }
    finally { setBusy(false); }
  }
  async function switchSpace(name: string) {
    setBusy(true); setError('');
    try { onStateLoaded(await switchTeamSpace(pluginStorage, name)); refreshSpaces(); }
    catch (value) { showError(value); }
    finally { setBusy(false); }
  }
  return <section className="pipeline-sdk-preferences pipeline-team-sync" aria-label="团队同步（文件交换）">
    <h4>团队同步（文件交换）</h4>
    <p>插件运行在隔离沙箱内，无法直接联网；团队共享通过文件完成。</p>
    <p>导出你的星图，交给 Being 或伙伴提交到团队仓库；导入团队包更新本地星图。应用前自动备份，可随时恢复最近一次导入前的数据。</p>
    <div className="pipeline-sdk-actions">
      <button type="button" disabled={busy} onClick={() => {
        setError('');
        try { const exported = createTeamExport(pluginStorage, __STARMAP_VERSION__); downloadTeamExport(exported); pluginToast('已导出 ' + Object.keys(exported.data.spaces).length + ' 个空间、' + exported.demandCount + ' 条星轨'); }
        catch (value) { showError(value); }
      }}>导出团队包</button>
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>导入团队包</button>
      <button type="button" disabled={busy} onClick={() => { setError(''); try { setBackup(readImportBackup(pluginStorage)); } catch (value) { showError(value); } }}>恢复导入前备份</button>
    </div>
    <input ref={fileInput} type="file" accept=".json" aria-label="选择团队包" hidden onChange={event => void chooseFile(event.target.files?.[0])} />
    {spaceNames.length > 1 && <label>当前空间<select aria-label="当前团队空间" value={activeSpace} disabled={busy} onChange={event => void switchSpace(event.target.value)}>{spaceNames.map(name => <option key={name}>{name}</option>)}</select></label>}
    {error && <p role="alert">{error}</p>}
    {busy && !team && !backup && <SyncDialog title="正在处理团队空间" busy={true} onClose={() => {}}><p>正在读取文件或保存空间，请稍候…</p></SyncDialog>}
    {team && <SyncDialog title="导入团队包" busy={busy} onClose={() => { setTeam(null); setError(''); }}>
      <p>共 {team.total} 个空间，{team.rejected.length} 个无效空间将被剔除。确认前不会改动数据。</p>
      <p>合并按星轨 id 求并集，同 id 整条取较新 updated_at；缺失或相同则使用导入。星轨内的站和节点随整条一起替换。</p>
      <label>全部空间<select aria-label="全部空间导入方式" defaultValue="" disabled={busy} onChange={event => setChoices(Object.fromEntries(Object.keys(team.spaces).map(name => [name, event.target.value as ImportChoice])))}>
        <option value="" disabled>逐空间选择</option>{Object.entries(choiceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {Object.keys(team.spaces).map(name => <label key={name} className="pipeline-team-choice">{name}<select aria-label={'空间「' + name + '」导入方式'} value={choices[name]} disabled={busy} onChange={event => setChoices({ ...choices, [name]: event.target.value as ImportChoice })}>{Object.entries(choiceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
      {team.rejected.map(item => <p key={item.space}>剔除「{item.space}」：{item.reason}</p>)}
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => { setTeam(null); setError(''); }}>取消</button>
      <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{busy ? '正在备份并应用…' : '确认导入'}</button>
    </SyncDialog>}
    {backup && <SyncDialog title="恢复导入前备份" busy={busy} onClose={() => { setBackup(null); setError(''); }}>
      <p>备份时间：{new Date(backup.backedUpAt).toLocaleString()}</p><p>空间数：{Object.keys(backup.collection.spaces).length}</p>
      <p>将完整覆盖当前星图与团队空间，最近一次备份仍保留。</p>{error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => { setBackup(null); setError(''); }}>取消</button>
      <button type="button" className="primary" disabled={busy} onClick={() => void restore()}>{busy ? '正在恢复…' : '确认恢复'}</button>
    </SyncDialog>}
    {report && <SyncDialog title="导入报告" busy={false} onClose={() => setReport(null)}>
      <p>总空间数：{report.total}；新增：{report.added}；覆盖：{report.replaced}；合并：{report.merged}；保留：{report.kept}；剔除：{report.rejected.length}</p>
      {report.rejected.map(item => <p key={item.space}>剔除「{item.space}」：{item.reason}</p>)}
      <h4>同 id 冲突记录（{report.conflicts.length}）</h4>
      {report.conflicts.map(item => <details key={item.space + ':' + item.id}><summary>{item.space} · {item.id} · {item.winner === 'local' ? '本地较新，保留本地' : '使用导入'}</summary><pre>旧值：{JSON.stringify(item.before, null, 2)}{' → '}新值：{JSON.stringify(item.after, null, 2)}</pre></details>)}
      <button type="button" onClick={() => setReport(null)}>关闭报告</button>
    </SyncDialog>}
  </section>;
}
