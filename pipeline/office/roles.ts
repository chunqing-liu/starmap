import type { OfficeIdentity } from './identities';

export type OfficeRole = 'engine' | 'backend' | 'frontend' | 'product' | 'test' | 'general';
const profiles: Record<OfficeRole, { label: string; accent: number }> = {
  engine: { label: '引擎开发', accent: 0x658993 }, backend: { label: '后端开发', accent: 0x7b9476 },
  frontend: { label: '前端开发', accent: 0xb68c68 }, product: { label: '产品', accent: 0xbb956e },
  test: { label: '测试', accent: 0x8288a7 }, general: { label: '团队伙伴', accent: 0x7c9196 },
};
function classify(description: string): OfficeRole {
  const role: OfficeRole = /引擎|engine|render|图形|渲染/.test(description) ? 'engine'
    : /后端|backend|back.end|server|服务端/.test(description) ? 'backend'
    : /前端|frontend|front.end|web|界面/.test(description) ? 'frontend'
    : /产品|product|设计|design/.test(description) ? 'product'
    : /测试|test|qa/.test(description) ? 'test' : 'general';
  return role;
}
export function officeRole(identity: OfficeIdentity) {
  const explicit = classify((identity.role || '').toLowerCase());
  const role = explicit !== 'general' ? explicit : classify([identity.responsibilities, identity.name, ...identity.owners].filter(Boolean).join(' ').toLowerCase());
  return { role, ...profiles[role] };
}
