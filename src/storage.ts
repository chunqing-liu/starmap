import { GitLabClient, type CredentialProvider, type HostFetch, type RepositoryConfig } from './gitlab-client';
import type { PipelineLocalState } from './models/schema';

export function createTeamStorage(hostFetch: HostFetch, credentials: CredentialProvider, config: RepositoryConfig) {
  const client = new GitLabClient(hostFetch, credentials, config);
  return {
    target: client.target,
    load: (space: string) => client.load(space),
    save: (space: string, data: PipelineLocalState, baseRev: string | null, actor: string) => client.save(space, data, baseRev, actor),
    listSpaces: () => client.listSpaces(),
    revision: (space: string) => client.revision(space),
  };
}
export type TeamStorage = ReturnType<typeof createTeamStorage>;
