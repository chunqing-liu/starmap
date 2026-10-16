export function deletionProtected(item: { locked?: boolean; kind?: string }) {
  return Boolean(item.locked || item.kind === 'gate');
}
