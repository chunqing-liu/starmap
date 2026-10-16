import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

export async function loadInstalledHostRuntime(asarPath) {
  const openArchive = process.versions.electron ? createRequire(import.meta.url)('original-fs').promises.open : open;
  const handle = await openArchive(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16); await handle.read(prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    assert(jsonSize > 0 && jsonSize < 16 * 1024 * 1024);
    const header = Buffer.alloc(jsonSize); await handle.read(header, 0, jsonSize, 16);
    const directory = JSON.parse(header.toString('utf8'));
    const readPublicCode = async path => {
      let entry = directory;
      for (const name of path.split('/')) entry = entry.files[name];
      assert(entry && !entry.unpacked && entry.size < 32 * 1024 * 1024);
      const buffer = Buffer.alloc(entry.size); await handle.read(buffer, 0, entry.size, 8 + headerSize + Number(entry.offset));
      return buffer.toString('utf8');
    };
    const metadata = JSON.parse(await readPublicCode('package.json'));
    const source = await readPublicCode(metadata.main);
    const parsed = ts.createSourceFile('installed-public-code.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node));
    const service = functions.find(node => node.getText(parsed).includes('t==="network.fetch"'));
    assert(service, 'Installed public network service not recognized; do not assume redirect safety.');
    const helperName = service.getText(parsed).match(/new URL\(([$\w]+)\(/)?.[1];
    const helper = functions.find(node => node.name?.text === helperName);
    assert(helper, 'Installed URL validator not recognized.');
    let sdk;
    const visit = node => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.includes('grove:request') && node.text.includes('sdkVersion')) sdk = node.text;
      ts.forEachChild(node, visit);
    };
    visit(parsed); assert(sdk, 'Installed injected SDK not recognized.');
    assert(source.includes('fetcher:globalThis.fetch'), 'Installed plugin fetch backend not recognized.');
    const context = createContext({ URL, TextDecoder, AbortSignal });
    const createPluginServices = runInContext(helper.getText(parsed) + '\n' + service.getText(parsed) + '\n' + service.name.text, context);
    return { createPluginServices, PLUGIN_SDK: sdk, sourceVersion: metadata.version, installed: true,
      capabilityFor(method) { assert.equal(method, 'network.fetch'); return 'network'; } };
  } finally { await handle.close(); }
}
