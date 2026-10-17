import { NetworkError, requireSecureRepository, validateSpaceName, type RepositoryConfig } from './gitlab-client';

export interface SharedConnection {
  kind: 'starmap-connection';
  version: 1;
  baseUrl: string;
  projectId: number;
  branch: string;
  space: string;
}

const sharedKeys = ['baseUrl', 'branch', 'kind', 'projectId', 'space', 'version'];
const branchPattern = /^[a-zA-Z0-9_-][a-zA-Z0-9._/-]{0,199}$/;

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NetworkError('format', '连接信息不是对象；不会修改当前草稿。');
  return value as Record<string, unknown>;
}

function validateBranch(branch: unknown): string {
  if (typeof branch !== 'string' || !branchPattern.test(branch) || /\.\.|\/\/|[\/.]$|\.lock$/.test(branch)) throw new NetworkError('format', '连接信息中的分支不合法；不会修改当前草稿。');
  return branch;
}

function validateConnection(config: RepositoryConfig, space: unknown): SharedConnection {
  requireSecureRepository(config);
  const baseUrl = new URL(config.baseUrl).origin;
  if (!Number.isSafeInteger(config.projectId) || config.projectId <= 0) throw new NetworkError('format', '连接信息中的项目 ID 不合法；不会修改当前草稿。');
  const branch = validateBranch(config.branch);
  if (typeof space !== 'string') throw new NetworkError('format', '连接信息缺少有效空间；不会修改当前草稿。');
  validateSpaceName(space);
  return { kind: 'starmap-connection', version: 1, baseUrl, projectId: config.projectId, branch, space };
}

export function createSharedConnection(config: RepositoryConfig, space: string): SharedConnection {
  return validateConnection(config, space);
}

export function serializeSharedConnection(config: RepositoryConfig, space: string): string {
  return JSON.stringify(createSharedConnection(config, space), null, 2);
}

export function parseSharedConnection(text: string): SharedConnection {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new NetworkError('format', '连接信息不是有效 JSON；不会修改当前草稿。'); }
  const input = objectValue(value);
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(sharedKeys)) throw new NetworkError('format', '连接信息含不允许的字段；请仅粘贴星图生成的非秘密连接信息。');
  if (input.kind !== 'starmap-connection' || input.version !== 1) throw new NetworkError('format', '连接信息版本不受支持；不会修改当前草稿。');
  if (typeof input.baseUrl !== 'string') throw new NetworkError('format', '连接信息缺少有效 GitLab origin；不会修改当前草稿。');
  return validateConnection({ baseUrl: input.baseUrl, projectId: input.projectId as number, branch: input.branch as string }, input.space);
}
