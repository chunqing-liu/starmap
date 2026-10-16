import { pluginStorage } from './host';
import { createInitialPipelineState, loadPipelineState } from './models/templates';
import { NetworkError } from './gitlab-client';
import { SessionLogin } from './network-auth';
import type { TeamStorage } from './storage';
import { TeamSync } from './sync';

let session: TeamSync | undefined;
const hostFetch = async (url: string, init?: Parameters<typeof window.grove.network.fetch>[1]) => {
  if (!window.grove.network?.fetch) throw new NetworkError('network', '当前宿主未提供 SDK 1.5 网络接口。');
  return window.grove.network.fetch(url, init);
};
export const networkLogin = new SessionLogin(hostFetch, pluginStorage, createInitialPipelineState);
export function networkSession(space?: string) {
  if (!session || (space && session.space !== space)) {
    session?.dispose();
    const unavailable = async (): Promise<never> => { throw new NetworkError('credentials', '请先选择团队仓库并登录。'); };
    const remote: TeamStorage = { target: 'unconfigured', load: unavailable, save: unavailable, listSpaces: unavailable, revision: unavailable };
    session = new TeamSync(remote, pluginStorage, space || 'team', loadPipelineState());
  }
  return session;
}
