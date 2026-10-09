import { OFFICE_SEEDS, type OfficeIdentity as SharedIdentity } from '../../../shared/office';

export type OfficeIdentity = Omit<SharedIdentity, 'assignedUsers'> & { assignedUsers?: string[] };
export const DEMO_IDENTITIES: OfficeIdentity[] = OFFICE_SEEDS;

export class IdentityRegistry {
  private identities = new Map<string, OfficeIdentity>();
  constructor(identities: OfficeIdentity[]) { identities.forEach(identity => this.register(identity)); }
  register(identity: OfficeIdentity) {
    if (!identity.id || this.identities.has(identity.id)) throw new Error('身份 ID 为空或已注册');
    this.identities.set(identity.id, structuredClone(identity));
  }
  unregister(id: string) { return this.identities.delete(id); }
  list() { return [...this.identities.values()].map(identity => structuredClone(identity)); }
}

export type NodeStateSource = { kind: 'local' } | { kind: 'being'; beingId: string; reportedAt: number };
export interface BeingNodeReport {
  demandId: string;
  nodeId: string;
  status: import('../models/schema').NodeStatus;
  reason?: string;
  source: Extract<NodeStateSource, { kind: 'being' }>;
}
