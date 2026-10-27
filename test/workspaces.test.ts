import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile, lstat,chmod,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Project} from '../src/contracts.ts';
import {defaultRoles} from '../src/defaults.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';
import {Workspaces} from '../src/workspaces.ts';

const execute = promisify(execFile);
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-workspace-test-')), source = path.join(directory, 'source');
  await mkdir(source);
  const git = (...args: string[]) => execute('git', ['-C', source, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', ...args]);
  await git('init', '--template=');
  await writeFile(path.join(source, '.gitignore'), '.local/\n.env\nnode_modules/\n');
  await writeFile(path.join(source, 'tracked.txt'), 'Committed synthetic input.\n');
  await writeFile(path.join(source, 'package-lock.json'), '{"name":"synthetic-workspace","lockfileVersion":3,"packages":{}}\n');
  await git('add', '--', '.gitignore', 'tracked.txt', 'package-lock.json'); await git('commit', '-m', 'Create synthetic committed input');
  const store = new Store(path.join(directory, 'state')), workspaces = new Workspaces(store, path.join(directory, 'executions'));
  const project: Project = {id: 'synthetic-project', revision: 1, name: 'Synthetic isolated project', description: '', workspace: source, repository: '', roles: defaultRoles(), knowledgeSources: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
  t.after(async () => {store.close(); await rm(directory, {recursive: true, force: true});});
  return {directory, source, git, store, workspaces, project};
}
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

test('execution checkout uses committed input and excludes dirty, untracked, ignored and installed dependency state', async t => {
  const h = await fixture(t), commit = (await h.git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(path.join(h.source, 'tracked.txt'), 'Private dirty source edit.\n');
  await writeFile(path.join(h.source, 'scratch.txt'), 'Private untracked scratch.\n');
  await mkdir(path.join(h.source, '.local')); await writeFile(path.join(h.source, '.local', 'runtime.json'), '{"syntheticPrivate":"keep local"}\n');
  await writeFile(path.join(h.source, '.env'), 'SYNTHETIC_PRIVATE_VALUE=local-only\n');
  await mkdir(path.join(h.source, 'node_modules')); await writeFile(path.join(h.source, 'node_modules', 'synthetic-private-cache.txt'), 'Private installed state.\n');
  const [first, concurrent] = await Promise.all([h.workspaces.ensure(h.project, 'synthetic-run'), h.workspaces.ensure(h.project, 'synthetic-run')]);
  assert.deepEqual(first, concurrent); assert.equal(first.sourceCommit, commit); assert.notEqual(first.path, h.source);
  assert.equal(await readFile(path.join(first.path, 'tracked.txt'), 'utf8'), 'Committed synthetic input.\n');
  for (const file of ['scratch.txt', '.local', '.env', 'node_modules']) assert.equal(await lstat(path.join(first.path, file)).catch(() => null), null, `Private input is absent: ${file}`);
  await writeFile(path.join(first.path, 'tracked.txt'), 'Isolated synthetic correction.\n');
  assert.equal(await readFile(path.join(h.source, 'tracked.txt'), 'utf8'), 'Private dirty source edit.\n');
  const changes = await h.workspaces.changes(first.id); assert.match(changes.diff, /Isolated synthetic correction/); assert.match(changes.status, /tracked\.txt/);
  await h.git('add', '--', 'tracked.txt'); await h.git('commit', '-m', 'Advance the synthetic source revision');
  const restored = new Workspaces(h.store, path.join(h.directory, 'executions'));
  assert.deepEqual(await restored.ensure(h.project, first.id), first); assert.equal((await restored.artifact(first.id, 'tracked.txt')).sourceCommit, commit);
});

test('execution artifact previews reject traversal, private paths, symlink escapes and oversized files', async t => {
  const h = await fixture(t), record = await h.workspaces.ensure(h.project, 'synthetic-preview-run');
  assert.equal((await h.workspaces.artifact(record.id, 'tracked.txt')).content, 'Committed synthetic input.\n');
  const outside = path.join(h.directory, 'synthetic-private.txt'); await writeFile(outside, 'Private outside content.\n');
  await symlink(outside, path.join(record.path, 'escape.txt'));
  await writeFile(path.join(record.path, 'oversized.txt'), 'x'.repeat(512 * 1024 + 1));
  for (const relative of ['../synthetic-private.txt', '.git/config', '.local/runtime.json', '.env', outside]) await assert.rejects(h.workspaces.artifact(record.id, relative), code('INVALID_ARTIFACT_PATH'));
  await assert.rejects(h.workspaces.artifact(record.id, 'escape.txt'), code('INVALID_ARTIFACT_PATH'));
  await assert.rejects(h.workspaces.artifact(record.id, 'oversized.txt'), code('ARTIFACT_NOT_PREVIEWABLE'));
  await assert.rejects(h.workspaces.ensure(h.project, '../escape-run'), code('INVALID_EXECUTION_ID'));
});

test('verification captures prepared edits, staged deletions and untracked source without copying runtime state',async t=>{
  const h=await fixture(t),checkout=await h.workspaces.ensure(h.project,'synthetic-verify-run');
  await writeFile(path.join(checkout.path,'tracked.txt'),'Actual prepared bytes.\n');
  await execute('git',['-C',checkout.path,'rm','--','package-lock.json']);
  await writeFile(path.join(checkout.path,'new-source.ts'),'export const prepared = true;\n');
  await writeFile(path.join(checkout.path,'staged-source.ts'),'export const staged = true;\n');await execute('git',['-C',checkout.path,'add','--','staged-source.ts']);
  await symlink('tracked.txt',path.join(checkout.path,'safe-link'));
  await mkdir(path.join(checkout.path,'.local'));await writeFile(path.join(checkout.path,'.local','private.json'),'Private synthetic runtime state.');
  await mkdir(path.join(checkout.path,'node_modules'));await writeFile(path.join(checkout.path,'node_modules','runtime.txt'),'Installed state.');
  const copy=await h.workspaces.prepareVerification(h.project,checkout.id,'synthetic-verification-attempt');
  assert.notEqual(copy.path,checkout.path);assert.notEqual(copy.path,h.source);assert.match(copy.manifest.sha256,/^[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(copy.path,'tracked.txt'),'utf8'),'Actual prepared bytes.\n');
  assert.equal(await readFile(path.join(copy.path,'new-source.ts'),'utf8'),'export const prepared = true;\n');
  assert.equal(await readFile(path.join(copy.path,'staged-source.ts'),'utf8'),'export const staged = true;\n');assert.equal(copy.manifest.entries.find(entry=>entry.path==='staged-source.ts')?.tracked,true);
  assert.equal(await readFile(path.join(copy.path,'safe-link'),'utf8'),'Actual prepared bytes.\n');
  for(const filename of ['package-lock.json','.local','node_modules'])assert.equal(await lstat(path.join(copy.path,filename)).catch(()=>null),null);
  assert.deepEqual(copy.manifest.entries.find(entry=>entry.path==='package-lock.json'),{path:'package-lock.json',kind:'deleted',tracked:true});
  assert.equal(copy.manifest.entries.find(entry=>entry.path==='new-source.ts')?.tracked,false);
  assert.equal((await h.workspaces.checkVerification(copy.id)).unchanged,true);
  await mkdir(path.join(copy.path,'.gwi-verification'));await writeFile(path.join(copy.path,'.gwi-verification','scratch.txt'),'Disposable scratch.');
  await mkdir(path.join(copy.path,'node_modules'));await writeFile(path.join(copy.path,'node_modules','cache.txt'),'Disposable cache.');
  assert.equal((await h.workspaces.checkVerification(copy.id)).unchanged,true);
  assert.equal(await readFile(path.join(h.source,'tracked.txt'),'utf8'),'Committed synthetic input.\n');
  assert.equal(await readFile(path.join(checkout.path,'tracked.txt'),'utf8'),'Actual prepared bytes.\n');
  await h.workspaces.disposeVerification(copy.id);assert.equal(await lstat(copy.path).catch(()=>null),null);assert.ok(h.workspaces.verification(copy.id).disposedAt);
  assert.equal((await h.workspaces.verification(copy.id)).manifest.sha256,copy.manifest.sha256);
});

test('verification detects source edits, mode changes, new source and resurrected deletions before accepting review',async t=>{
  for(const mutation of ['edit','mode','new-source','resurrect'] as const)await t.test(mutation,async sub=>{
    const h=await fixture(sub),checkout=await h.workspaces.ensure(h.project,'synthetic-mutation-run');
    await rm(path.join(checkout.path,'package-lock.json'));
    const copy=await h.workspaces.prepareVerification(h.project,checkout.id,'synthetic-mutation-attempt');
    if(mutation==='edit')await writeFile(path.join(copy.path,'tracked.txt'),'Review silently changes prepared code.\n');
    if(mutation==='mode')await chmod(path.join(copy.path,'tracked.txt'),0o755);
    if(mutation==='new-source')await writeFile(path.join(copy.path,'extra-source.ts'),'export const changed = true;\n');
    if(mutation==='resurrect')await writeFile(path.join(copy.path,'package-lock.json'),'{}\n');
    const check=await h.workspaces.checkVerification(copy.id);assert.equal(check.unchanged,false);assert.notEqual(check.observedHash,check.manifestHash);assert.ok(check.changed.length>0);
    assert.equal(await readFile(path.join(checkout.path,'tracked.txt'),'utf8'),'Committed synthetic input.\n');
    assert.equal(await lstat(path.join(checkout.path,'package-lock.json')).catch(()=>null),null);
  });
});

test('verification rejects escaping, absolute and private-target symlinks and tracked private runtime input',async t=>{
  for(const variant of ['outside','absolute','private-target','tracked-private'] as const)await t.test(variant,async sub=>{
    const h=await fixture(sub),checkout=await h.workspaces.ensure(h.project,'synthetic-unsafe-run');
    const outside=path.join(h.directory,'private.txt');await writeFile(outside,'Synthetic private external content.');
    if(variant==='outside')await symlink('../../../../private.txt',path.join(checkout.path,'unsafe-link'));
    if(variant==='absolute')await symlink(path.join(checkout.path,'tracked.txt'),path.join(checkout.path,'unsafe-link'));
    if(variant==='private-target'){await writeFile(path.join(checkout.path,'.env'),'SYNTHETIC_PRIVATE=value');await symlink('.env',path.join(checkout.path,'unsafe-link'));}
    if(variant==='tracked-private'){await mkdir(path.join(checkout.path,'.local'));await writeFile(path.join(checkout.path,'.local','private.txt'),'Private runtime');await execute('git',['-C',checkout.path,'add','-f','--','.local/private.txt']);}
    await assert.rejects(h.workspaces.prepareVerification(h.project,checkout.id,'synthetic-unsafe-attempt'),code(variant==='tracked-private'?'VERIFICATION_PRIVATE_INPUT':'VERIFICATION_UNSAFE_SYMLINK'));
    assert.equal(h.store.get('verification-workspace','synthetic-unsafe-attempt'),null);
    assert.equal(await readFile(outside,'utf8'),'Synthetic private external content.');
  });
});

test('self-project verification permits ignored application state and rejects an unignored source directory',async t=>{
  for(const ignored of [true,false])await t.test(ignored?'ignored runtime directory':'unignored source directory',async sub=>{
    const h=await fixture(sub),root=path.join(h.source,ignored?'.local':'verification-runtime','executions'),workspaces=new Workspaces(h.store,root),checkout=await workspaces.ensure(h.project,'synthetic-self-run');
    if(!ignored){await assert.rejects(workspaces.prepareVerification(h.project,checkout.id,'synthetic-self-attempt'),code('VERIFICATION_SCOPE_CONFLICT'));return;}
    await writeFile(path.join(checkout.path,'tracked.txt'),'Prepared self-project bytes.\n');
    const copy=await workspaces.prepareVerification(h.project,checkout.id,'synthetic-self-attempt');assert.ok(copy.path.startsWith(await realpath(h.source)+path.sep));assert.equal((await workspaces.checkVerification(copy.id)).unchanged,true);assert.equal(await readFile(path.join(h.source,'tracked.txt'),'utf8'),'Committed synthetic input.\n');
  });
});
