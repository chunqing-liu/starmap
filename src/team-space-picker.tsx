import { useEffect, useRef, useState } from 'react';
import { NetworkError } from './gitlab-client';
import type { TeamSync } from './sync';

export function TeamSpacePicker({ sync, onSelect }: { sync: TeamSync; onSelect(space: string): Promise<void> }) {
  const [names, setNames] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  async function refresh() {
    const current = ++request.current;
    setBusy(true); setError('');
    try {
      const spaces = await sync.remote.listSpaces();
      if (current === request.current) setNames(spaces);
    } catch (failure) {
      if (current === request.current) setError(failure instanceof NetworkError ? failure.message : '共享空间目录读取失败；当前空间和草稿保留，请重试。');
    } finally { if (current === request.current) setBusy(false); }
  }
  useEffect(() => {
    setNames(null); void refresh();
    return () => { request.current++; };
  }, [sync]);
  async function select(space: string) {
    if (space === sync.space) return;
    const current = ++request.current;
    setBusy(true); setError('');
    try { await onSelect(space); }
    catch (failure) {
      if (current === request.current) setError(failure instanceof NetworkError ? failure.message : '切换共享空间失败；当前空间和草稿保留，请重试。');
    } finally { if (current === request.current) setBusy(false); }
  }
  return <TeamSpacePickerView space={sync.space} names={names} busy={busy} syncBusy={sync.snapshot().busy} error={error} onSelect={space => void select(space)} onRefresh={() => void refresh()} />;
}

export function TeamSpacePickerView({ space, names, busy, syncBusy, error, onSelect, onRefresh }: {
  space: string; names: string[] | null; busy: boolean; syncBusy: boolean; error: string;
  onSelect(space: string): void; onRefresh(): void;
}) {
  return <div className="pipeline-team-spaces" role="region" aria-label="共享空间目录" aria-busy={busy}>
    <label>团队数据空间<select aria-label="选择共享空间" value={space} disabled={busy || syncBusy || !names?.length} onChange={event => onSelect(event.target.value)}>
      {!names?.includes(space) && <option value={space}>{space}{names === null ? '（当前空间）' : '（当前空间，目录中未列出）'}</option>}
      {names?.map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <button type="button" disabled={busy} onClick={onRefresh}>刷新空间列表</button>
    {busy && <span role="status">正在读取或切换共享空间…</span>}
    {!busy && !error && names?.length === 0 && <p role="status">此分支暂无共享空间。可在联网设置中填写空间标识，拉取核验后确认首次写入。</p>}
    {error && <p role="alert">{error}{names !== null && ' 目录可能已过期，请刷新后重试。'}</p>}
  </div>;
}
