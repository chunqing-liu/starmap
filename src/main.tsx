import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import { Pipeline } from './page';
import { PipelineSettings } from './integrations';
import { PipelineWorkspace } from './workspace';
import { initializeStorage } from './host';
import './theme.css';
class PluginBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p role="alert">看板加载失败：{this.state.error}。请返回插件管理后重新打开。</p> : this.props.children; }
}
async function start() {
  const root = createRoot(document.getElementById('root')!);
  try { await initializeStorage(); root.render(<PluginBoundary>{window.grove.view === 'settings' ? <PipelineSettings /> : window.grove.view === 'companion' ? <PipelineWorkspace /> : <Pipeline />}</PluginBoundary>); }
  catch (error) { root.render(<p role="alert">无法读取看板数据：{String(error)}。请重新打开插件。</p>); }
}
void start();
