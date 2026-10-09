import type { GroveSDK } from '@beings/grove-plugin-sdk';
declare global { interface Window { grove: GroveSDK } }
let values: Record<string, string> = Object.create(null);
let saveRevision = 0;
function status(text: string) { const element = document.getElementById('plugin-status'); if (element) element.textContent = text; }
export async function initializeStorage() {
  const data = await window.grove.loadData();
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new Error('看板存储格式无法识别。');
  for (const [key, value] of Object.entries(data || {})) if (typeof value === 'string') values[key] = value;
  status('已载入');
}
// Keep the upstream schema and per-demand comment keys, backed by host-owned data.
export const pluginStorage = {
  getItem: (key: string) => values[key] ?? null,
  setItem(key: string, value: string) {
    values[key] = value;
    const revision = ++saveRevision;
    status('正在保存…');
    void window.grove.updateData({ [key]: value }).then(() => { if (revision === saveRevision) status('已保存到本机'); }, error => {
      status(`保存失败：${error instanceof Error ? error.message : '请重试'}。请保留页面并继续编辑以重试保存。`);
    });
  },
};
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function pluginToast(message: unknown) {
  let element = document.getElementById('plugin-toast');
  if (!element) { element = document.createElement('div'); element.id = 'plugin-toast'; element.setAttribute('role', 'status'); document.body.append(element); }
  element.textContent = String(message); element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
}
function ask(message: string, initial?: string): Promise<string | null> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    const form = document.createElement('form'); form.method = 'dialog';
    const label = document.createElement('label'); label.textContent = message;
    const input = document.createElement('input'); input.value = initial || ''; input.setAttribute('aria-label', message);
    if (initial !== undefined) label.append(input);
    const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.type = 'button'; cancel.onclick = () => dialog.close('cancel');
    const submit = document.createElement('button'); submit.textContent = '确定'; submit.type = 'button'; submit.className = 'primary'; submit.onclick = () => dialog.close('confirm');
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); dialog.close('confirm'); } };
    form.append(label, cancel, submit); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => { const result = dialog.returnValue === 'confirm' ? input.value : null; dialog.remove(); resolve(result); }, { once: true });
    dialog.showModal(); if (initial !== undefined) { input.focus(); input.select(); }
  });
}
export const pluginPrompt = (message: string, initial = '') => ask(message, initial);
export const pluginConfirm = async (message: string) => await ask(message) !== null;
