import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {setImmediate as immediate} from 'node:timers/promises';
import {AdoptionService} from '../src/adoption.ts';
import type {Adoption, AdoptionProposal} from '../src/adoption.ts';
import {Engine} from '../src/engine.ts';
import {defaultRoles} from '../src/defaults.ts';
import {Store} from '../src/store.ts';
import {AppError} from '../src/validation.ts';
import type {Actor, Project, TaskOutput} from '../src/contracts.ts';
import type {CodexAdapter, CodexExecutionInput} from '../src/adapters/types.ts';

const OWNER: Actor = {name: 'Synthetic adoption owner', kind: 'human'};
const OUTPUT: TaskOutput = {outcome: 'done', summary: 'Synthetic project setup proposed for owner review.', artifacts: [], observations: ['Synthetic build commands were read as source, not executed.']};
class SyntheticCodex implements CodexAdapter {
  calls: {input: CodexExecutionInput; finish: (output?: TaskOutput) => void; fail: (error: Error) => void}[] = [];
  async info() { return {available: true, connected: true, authenticated: true, models: []}; }
  async skills() { return []; }
  async start(input: CodexExecutionInput) {
    let resolve!: (value: {output: TaskOutput}) => void, reject!: (error: Error) => void;
    const completion = new Promise<{output: TaskOutput}>((done, failed) => { resolve = done; reject = failed; });
    void completion.catch(() => {});
    const call = {input, finish: (output = OUTPUT) => resolve({output}), fail: reject}; this.calls.push(call);
    input.signal.addEventListener('abort', () => reject(new Error('Synthetic scan interrupted.')), {once: true});
    const ref = {threadId: `synthetic-adoption-thread-${this.calls.length}`, turnId: `synthetic-adoption-turn-${this.calls.length}`};
    input.onEvent({type: 'synthetic.scan.started', message: 'Synthetic native scan started.', ref});
    return {ref, completion};
  }
  async steer() {}
  async interrupt() {}
  async close() { for (const call of this.calls) call.fail(new Error('Synthetic adapter closed.')); await immediate(); }
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gwi-adoption-test-')), workspace = path.join(directory, 'workspace');
  await mkdir(path.join(workspace, 'docs'), {recursive: true}); await mkdir(path.join(workspace, '.github/workflows'), {recursive: true});
  await writeFile(path.join(workspace, 'README.md'), '# Synthetic Harbor\nA small synthetic project. Test using the documented local command.\n');
  await writeFile(path.join(workspace, 'AGENTS.md'), 'Synthetic project instructions. Keep changes bounded and review evidence.\n');
  await writeFile(path.join(workspace, 'docs/usage.md'), 'Synthetic usage and expected outcomes.\n');
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({name: 'synthetic-harbor', description: 'Synthetic package', scripts: {test: 'node --test'}, privateConfiguration: 'EXCLUDED_SYNTHETIC_PACKAGE_SETTING'}));
  await writeFile(path.join(workspace, '.github/workflows/check.yml'), 'name: Synthetic checks\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n');
  const codex = new SyntheticCodex(); let githubCalls = 0;
  const github = {info: async () => ({available: true, authenticated: true}), observe: async () => { githubCalls++; return {status: 'completed' as const, summary: 'Synthetic CI.'}; }, dispatch: async () => { githubCalls++; return {status: 'completed' as const, summary: 'Synthetic CI.'}; }};
  const engine = new Engine(new Store(path.join(directory, 'state')), codex, github), service = new AdoptionService(engine);
  t.after(async () => { await service.close(); await engine.close(); await rm(directory, {recursive: true, force: true}); });
  return {directory, workspace: await realpath(workspace), codex, engine, service, githubCalls: () => githubCalls};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const code = (value: string) => (error: unknown) => error instanceof AppError && error.code === value;
const input = (workspace: string, key = randomUUID()) => ({workspace, idempotencyKey: key});
function proposal(): AdoptionProposal {
  return {name: 'Synthetic Harbor', description: 'A bounded synthetic project.', repository: 'synthetic/harbor', rationale: 'The inspected README and usage document identify the useful starting workflow.', roles: [{id: 'development', instructions: 'Use the synthetic README and usage guidance for bounded implementation.'}, {id: 'qa', instructions: 'Check the expected outcome against synthetic usage evidence.'}], knowledgeSources: [{path: 'README.md', kind: 'document', roles: ['lead', 'development']}, {path: 'docs/usage.md', kind: 'document', roles: ['qa']}], pipelines: [{name: 'Synthetic bounded correction', description: 'Inspect, correct and independently review one documented mismatch.', roleId: 'lead', policy: {concurrency: 1, maxAttempts: 2, maxIterations: 1, timeoutSeconds: 30, tokenBudget: 1000}, stages: [{id: 'inspect', name: 'Inspect synthetic behavior', roleId: 'lead', executor: 'codex', dependsOn: [], prompt: 'Inspect the documented synthetic behavior.', review: false}, {id: 'correct', name: 'Prepare synthetic correction', roleId: 'development', executor: 'codex', dependsOn: ['inspect'], prompt: 'Prepare the bounded synthetic correction.', review: false}, {id: 'verify', name: 'Review synthetic correction', roleId: 'qa', executor: 'codex', dependsOn: ['correct'], prompt: 'Verify against synthetic usage evidence.', review: true, reworkTo: 'correct'}]}]};
}
async function waitStatus(h: Fixture, item: Adoption, status: Adoption['status']): Promise<Adoption> {
  for (let index = 0; index < 30; index++) { const current = h.service.get(item.id, OWNER); if (current.status === status) return current; await immediate(); }
  assert.fail(`Synthetic adoption did not reach ${status}.`);
}
async function recordProposal(h: Fixture, item: Adoption, proposed = proposal()): Promise<Adoption> {
  const call = h.codex.calls.at(-1)!;
  await call.input.onTool('project.bootstrap', {proposal: proposed, sources: ['README.md', 'docs/usage.md']});
  assert.equal(h.service.get(item.id, OWNER).status, 'scanning'); call.finish();
  return waitStatus(h, item, 'proposed');
}

test('read-only source collection produces a reviewed proposal and ordinary Engine project without executing work', async t => {
  const h = await fixture(t);
  const foreign = path.join(h.directory, 'foreign'); await mkdir(foreign); await writeFile(path.join(foreign, 'README.md'), 'EXCLUDED_SYNTHETIC_FOREIGN_SOURCE');
  await symlink(foreign, path.join(h.workspace, 'docs/linked'));
  await mkdir(path.join(h.workspace, 'docs/nested/.git'), {recursive: true}); await writeFile(path.join(h.workspace, 'docs/nested/README.md'), 'EXCLUDED_SYNTHETIC_NESTED_REPOSITORY');
  await writeFile(path.join(h.workspace, 'docs/credentials.md'), 'EXCLUDED_SYNTHETIC_CREDENTIAL_DOCUMENT');
  await writeFile(path.join(h.workspace, '.env'), 'EXCLUDED_SYNTHETIC_ENVIRONMENT');
  const item = await h.service.create(input(h.workspace), OWNER), call = h.codex.calls[0];
  assert.equal(item.status, 'scanning'); assert.equal(h.engine.store.list('project').length, 0);
  assert.equal(call.input.role.sandbox, 'read-only'); assert.deepEqual(call.input.role.skills, []); assert.deepEqual(call.input.role.tools, ['project.bootstrap']);
  assert.equal(call.input.workspace, h.workspace); assert.equal(call.input.timeoutSeconds, 300); assert.equal(call.input.tokenBudget, 160000);
  for (const excluded of ['EXCLUDED_SYNTHETIC_FOREIGN_SOURCE', 'EXCLUDED_SYNTHETIC_NESTED_REPOSITORY', 'EXCLUDED_SYNTHETIC_CREDENTIAL_DOCUMENT', 'EXCLUDED_SYNTHETIC_ENVIRONMENT', 'EXCLUDED_SYNTHETIC_PACKAGE_SETTING']) assert.equal(call.input.prompt.includes(excluded), false);
  assert.ok(item.sources.some(source => source.path === 'package.json' && source.transformation === 'package-metadata'));
  assert.ok(item.omissions.some(source => source.path === 'docs/linked')); assert.ok(item.omissions.some(source => source.path === 'docs/nested'));
  await assert.rejects(h.service.apply(item.id, h.service.get(item.id, OWNER).revision, OWNER), code('ADOPTION_NOT_READY'));
  const ready = await recordProposal(h, item); assert.equal(ready.ref?.threadId, 'synthetic-adoption-thread-1'); assert.deepEqual(ready.observations, OUTPUT.observations);
  await assert.rejects(h.service.apply(item.id, ready.revision - 1, OWNER), code('REVISION_CONFLICT'));
  const project = await h.service.apply(item.id, ready.revision, OWNER);
  assert.equal(project.workspace, h.workspace); assert.equal(project.name, 'Synthetic Harbor');
  assert.deepEqual(project.roles.map(role => [role.id, role.sandbox, role.tools]), defaultRoles().map(role => [role.id, role.sandbox, role.tools]));
  assert.match(project.roles.find(role => role.id === 'development')!.instructions, /synthetic README/);
  assert.equal(project.knowledgeSources[0].path, path.join(h.workspace, 'README.md'));
  assert.ok(h.engine.detail(project.id, OWNER).pipelines.some(pipeline => pipeline.name === 'Synthetic bounded correction' && pipeline.stages[2].reworkTo === 'correct'));
  assert.equal(h.engine.store.list('run').length, 0); assert.equal(h.githubCalls(), 0);
  assert.match(await readFile(path.join(h.workspace, 'README.md'), 'utf8'), /^# Synthetic Harbor/);
  assert.equal((await h.service.apply(item.id, ready.revision, OWNER)).id, project.id); assert.equal(h.engine.store.list('project').length, 1);
});

test('a model summary never becomes project configuration without the structured proposal tool', async t => {
  const h = await fixture(t), item = await h.service.create(input(h.workspace), OWNER);
  h.codex.calls[0].finish({...OUTPUT, summary: JSON.stringify(proposal())});
  const failed = await waitStatus(h, item, 'failed'); assert.match(failed.error!, /structured project proposal/);
  assert.equal(failed.proposal, undefined); assert.equal(h.engine.store.list('project').length, 0);
});

test('proposal validation rejects foreign paths, arbitrary roles, permission fields and cyclic stages', async t => {
  const cases = [
    {name: 'foreign evidence', expected: 'INVALID_ADOPTION_SOURCE', args: () => ({proposal: proposal(), sources: ['../foreign.md']})},
    {name: 'foreign knowledge path', expected: 'INVALID_ADOPTION_SOURCES', args: () => {const value = proposal(); value.knowledgeSources[0].path = '../foreign.md'; return {proposal: value, sources: ['README.md']};}},
    {name: 'arbitrary role', expected: 'INVALID_ADOPTION_ROLES', args: () => {const value = proposal(); value.roles[0].id = 'arbitrary-agent'; return {proposal: value, sources: ['README.md', 'docs/usage.md']};}},
    {name: 'permission expansion', expected: 'INVALID_ADOPTION_PROPOSAL', args: () => ({proposal: {...proposal(), sandbox: 'danger-full-access'}, sources: ['README.md']})},
    {name: 'cyclic stages', expected: 'PIPELINE_CYCLE', args: () => {const value = proposal(); value.pipelines[0].stages[0].dependsOn = ['verify']; return {proposal: value, sources: ['README.md', 'docs/usage.md']};}},
    {name: 'external dispatch', expected: 'INVALID_ADOPTION_PIPELINES', args: () => {const value = proposal(); value.pipelines[0].stages[0].executor = 'github'; return {proposal: value, sources: ['README.md', 'docs/usage.md']};}},
  ];
  for (const scenario of cases) await t.test(scenario.name, async child => {
    const h = await fixture(child), item = await h.service.create(input(h.workspace), OWNER);
    await assert.rejects(h.codex.calls[0].input.onTool('project.bootstrap', scenario.args()), code(scenario.expected));
    assert.equal(h.service.get(item.id, OWNER).proposal, undefined); assert.equal(h.engine.store.list('project').length, 0);
  });
});

test('invalid source kind gives one actionable correction and repaired kinds derive from inspected sources', async t => {
  const h = await fixture(t), item = await h.service.create(input(h.workspace), OWNER), call = h.codex.calls[0];
  assert.match(call.input.prompt, /"path":"README.md","kind":"document"/);
  assert.match(call.input.prompt, /kind is document or artifact, never file/);
  const wrong = proposal() as unknown as Record<string, unknown>;
  (wrong.knowledgeSources as Record<string, unknown>[])[0].kind = 'file';
  await assert.rejects(call.input.onTool('project.bootstrap', {proposal: wrong, sources: ['README.md', 'docs/usage.md']}), error => {
    assert.ok(error instanceof AppError); assert.equal(error.code, 'INVALID_ADOPTION_SOURCES');
    const details = error.details as Record<string, unknown>; assert.equal(details.path, 'README.md'); assert.equal(details.field, 'kind');
    assert.deepEqual(details.allowedKinds, ['document', 'artifact']); assert.ok((details.allowedRoles as string[]).includes('development')); assert.ok((details.allowedPaths as string[]).includes('docs/usage.md'));
    const feedback = JSON.parse(error.message) as {correctionsRemaining: number; instruction: string}; assert.equal(feedback.correctionsRemaining, 1); assert.match(feedback.instruction, /once more before returning blocked/); return true;
  });
  const repaired = proposal() as unknown as Record<string, unknown>, sources = repaired.knowledgeSources as Record<string, unknown>[];
  delete sources[0].kind; sources[1].kind = 'artifact'; sources.push({path: '.github/workflows/check.yml', roles: ['operations']});
  await call.input.onTool('project.bootstrap', {proposal: repaired, sources: ['README.md', 'docs/usage.md', '.github/workflows/check.yml']});
  await assert.rejects(call.input.onTool('project.bootstrap', {proposal: repaired, sources: ['README.md', 'docs/usage.md']}), code('ADOPTION_PROPOSAL_RECORDED'));
  call.finish(); const ready = await waitStatus(h, item, 'proposed');
  assert.deepEqual(ready.proposal!.knowledgeSources.map(source => source.kind), ['document', 'document', 'artifact']);
  assert.equal(h.codex.calls.length, 1); assert.equal(h.engine.store.list('project').length, 0);
});

test('scanned evidence cannot register unsupported Knowledge inputs and a corrected proposal stays usable', async t => {
  for (const filename of ['README', 'README.adoc', 'docs/auth.md', 'docs/settings.md', '.github/workflows/auth-check.yml']) await t.test(filename, async sub => {
    const h = await fixture(sub); await writeFile(path.join(h.workspace, filename), 'Synthetic setup evidence.');
    const item = await h.service.create(input(h.workspace), OWNER), call = h.codex.calls[0];
    const source = item.sources.find(source => source.path === filename && source.transformation === 'text-excerpt');
    assert.ok(source);
    const proposed = proposal(); proposed.knowledgeSources.push({path: filename, kind: source.kind, roles: []});
    await assert.rejects(call.input.onTool('project.bootstrap', {proposal: proposed, sources: ['README.md', 'docs/usage.md', filename]}), error => {
      assert.ok(error instanceof AppError); assert.equal(error.code, 'INVALID_ADOPTION_SOURCES');
      const feedback = error.details as {allowedPaths: string[]};
      assert.equal(feedback.allowedPaths.includes(filename), false); assert.ok(feedback.allowedPaths.includes('README.md')); return true;
    });
    const ready = await recordProposal(h, item), project = await h.service.apply(item.id, ready.revision, OWNER);
    const synced = await h.engine.sync(project.id, OWNER);
    assert.equal(synced.stats.errors, 0); assert.equal(synced.stats.added, 2);
    assert.equal(project.knowledgeSources.some(source => source.path.endsWith('/'+filename)), false);
    assert.equal(h.codex.calls.length, 1);
  });
});

test('proposal corrections stop after two calls and a failed scan retains its actual blocked output', async t => {
  const h = await fixture(t), item = await h.service.create(input(h.workspace), OWNER), call = h.codex.calls[0];
  const wrong = proposal() as unknown as Record<string, unknown>; (wrong.knowledgeSources as Record<string, unknown>[])[0].kind = 'file';
  for (let index = 0; index < 2; index++) await assert.rejects(call.input.onTool('project.bootstrap', {proposal: wrong, sources: ['README.md', 'docs/usage.md']}), code('INVALID_ADOPTION_SOURCES'));
  await assert.rejects(call.input.onTool('project.bootstrap', {proposal: proposal(), sources: ['README.md', 'docs/usage.md']}), code('ADOPTION_PROPOSAL_ATTEMPTS'));
  call.finish({...OUTPUT, outcome: 'blocked', summary: 'Synthetic setup remains blocked by invalid source kinds.'});
  const failed = await waitStatus(h, item, 'failed'); assert.equal(failed.output?.outcome, 'blocked'); assert.match(failed.output!.summary, /invalid source kinds/);
  assert.equal(failed.proposal, undefined); assert.equal(failed.events.filter(event => event.type === 'adoption.proposal_rejected').length, 2); assert.equal(h.engine.store.list('project').length, 0);
});

test('changed evidence is rejected before a project is created', async t => {
  const h = await fixture(t), item = await h.service.create(input(h.workspace), OWNER), ready = await recordProposal(h, item);
  await writeFile(path.join(h.workspace, 'README.md'), '# Synthetic content changed after review\n');
  await assert.rejects(h.service.apply(item.id, ready.revision, OWNER), code('ADOPTION_SOURCE_CHANGED'));
  assert.equal(h.engine.store.list('project').length, 0); const current = h.service.get(item.id, OWNER);
  assert.equal(current.status, 'proposed'); assert.match(current.error!, /evidence changed/);
});

test('scan starts deduplicate concurrent keys and reject broad workspaces or project-scoped callers', async t => {
  const h = await fixture(t), request = input(h.workspace);
  const [first, second] = await Promise.all([h.service.create(request, OWNER), h.service.create(request, OWNER)]);
  assert.equal(first.id, second.id); assert.equal(h.codex.calls.length, 1);
  await assert.rejects(h.service.create(input(h.workspace), OWNER), code('ADOPTION_SCAN_IN_PROGRESS'));
  await assert.rejects(h.service.create({...request, name: 'Another synthetic identity'}, OWNER), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(h.service.create(input(homedir()), OWNER), code('WORKSPACE_TOO_BROAD'));
  await assert.rejects(h.service.create(input(path.parse(h.workspace).root), OWNER), code('WORKSPACE_TOO_BROAD'));
  await assert.rejects(h.service.create(input(h.workspace), {...OWNER, projectId: 'scoped-project'}), code('OWNER_REQUIRED'));
});

test('interrupted and adapter-failed scans remain inspectable and are never silently restarted', async t => {
  const h = await fixture(t), item = await h.service.create(input(h.workspace), OWNER);
  h.codex.calls[0].fail(new Error('Synthetic provider unavailable.'));
  const failed = await waitStatus(h, item, 'failed'); assert.equal(failed.ref?.turnId, 'synthetic-adoption-turn-1'); assert.match(failed.error!, /Synthetic provider unavailable/);
  const persisted = {...failed, status: 'scanning' as const}; h.engine.store.put('adoption', persisted);
  const recovered = new AdoptionService(h.engine); recovered.recover();
  assert.equal(recovered.get(item.id, OWNER).status, 'failed'); assert.match(recovered.get(item.id, OWNER).error!, /restarted/); assert.equal(h.codex.calls.length, 1);
});

test('a partial Engine application retries the existing project and workflow instead of creating duplicates', async t => {
  const h = await fixture(t), item = await h.service.create(input(h.workspace), OWNER), ready = await recordProposal(h, item);
  const update = h.engine.updatePipeline.bind(h.engine); let fail = true;
  h.engine.updatePipeline = (...args) => { if (fail) { fail = false; throw new Error('Synthetic transient configuration failure.'); } return update(...args); };
  await assert.rejects(h.service.apply(item.id, ready.revision, OWNER), /Synthetic transient configuration failure/);
  const partial = h.service.get(item.id, OWNER); assert.equal(partial.status, 'proposed'); assert.ok(partial.application?.projectId);
  assert.equal(h.engine.store.list<Project>('project').length, 1); const before = h.engine.store.list('pipeline').length;
  const project = await h.service.apply(item.id, partial.revision, OWNER);
  assert.equal(project.id, partial.application.projectId); assert.equal(h.engine.store.list('project').length, 1); assert.equal(h.engine.store.list('pipeline').length, before); assert.equal(h.codex.calls.length, 1);
});
