import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeEntry, KnowledgeSource, Project } from '../src/contracts.ts';
import { searchKnowledge, syncKnowledge } from '../src/knowledge.ts';

async function fixture(run: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'gwi-knowledge-test-'));
  try {
    await run(await realpath(workspace));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function project(workspace: string, knowledgeSources: KnowledgeSource[]): Project {
  return {
    id: 'synthetic-project', revision: 1, name: 'Synthetic project', description: '', workspace,
    repository: 'example/synthetic', roles: [], knowledgeSources,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function source(path: string, values: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return { id: 'synthetic-source', path, kind: 'document', roles: ['developer'], ...values };
}

function lesson(values: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'lesson-example', projectId: 'synthetic-project', sourceId: 'run-example', kind: 'lesson', roles: [],
    title: 'Review finding', content: 'Bound the retry cycle. 限制重试次数。', hash: 'synthetic-hash', revision: 1,
    syncedAt: '2026-01-01T00:00:00.000Z', status: 'current', originRunId: 'run-example', ...values,
  };
}

test('a named memory section includes its subtree and excludes unrelated sections and code fences', async () => {
  await fixture(async workspace => {
    const memory = join(workspace, 'MEMORY.md');
    await writeFile(memory, [
      '# Personal interests', 'UNRELATED_PRIVATE_BEFORE', '',
      '```markdown', '# Project lessons', 'UNRELATED_FENCED_EXAMPLE', '```', '',
      '# Project lessons', 'Keep runs bounded. 保留同步证据。', '',
      '## Review', 'Use an independent reviewer.', '',
      '# Another project', 'UNRELATED_PRIVATE_AFTER', '',
    ].join('\n'));
    const config = project(workspace, [source(memory, { kind: 'memory', section: 'Project lessons' })]);
    const result = await syncKnowledge(config, []);
    assert.deepEqual(result.stats, { added: 1, changed: 0, unchanged: 0, missing: 0, errors: 0 });
    const entry = result.entries[0];
    assert.equal(entry.title, 'Project lessons');
    assert.match(entry.content, /Keep runs bounded/);
    assert.match(entry.content, /## Review/);
    assert.doesNotMatch(JSON.stringify(entry), /UNRELATED_/);
    assert.equal(entry.sourcePath, memory);
    assert.match(entry.sourceRevision!, /^sha256:[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(entry.syncedAt)));
    const firstSnapshot = structuredClone(result.entries);
    await writeFile(memory, [
      '# Personal interests', 'CHANGED_PRIVATE_MATERIAL', '',
      '# Project lessons', 'Keep runs bounded. 保留同步证据。', '',
      '## Review', 'Use an independent reviewer.', '',
      '# Another project', 'OTHER_CHANGED_PRIVATE_MATERIAL',
    ].join('\n'));
    const resynced = await syncKnowledge(config, result.entries);
    assert.equal(resynced.entries[0].revision, 1);
    assert.equal(resynced.entries[0].hash, entry.hash);
    assert.equal(resynced.stats.unchanged, 1);
    assert.deepEqual(result.entries, firstSnapshot);
    assert.doesNotMatch(JSON.stringify(resynced.entries), /PRIVATE_MATERIAL/);
  });
});

test('section selection fails closed when absent or ambiguous and isolates other sources', async () => {
  await fixture(async workspace => {
    const memory = join(workspace, 'MEMORY.md');
    const document = join(workspace, 'guide.md');
    await writeFile(memory, '# Other project\nPRIVATE_UNSELECTED_CONTENT\n');
    await writeFile(document, '# Guide\nA usable source.\n');
    const config = project(workspace, [
      source(memory, { section: 'Project lessons', kind: 'memory' }),
      source(document, { id: 'guide' }),
    ]);
    const missing = await syncKnowledge(config, []);
    assert.equal(missing.stats.errors, 1);
    assert.equal(missing.stats.added, 1);
    const failed = missing.entries.find(entry => entry.sourceId === 'synthetic-source')!;
    assert.equal(failed.status, 'error');
    assert.equal(failed.content, '');
    assert.doesNotMatch(JSON.stringify(missing), /PRIVATE_UNSELECTED_CONTENT/);
    await writeFile(memory, '# Project lessons\nFIRST_PRIVATE_MATCH\n# Project lessons\nSECOND_PRIVATE_MATCH\n');
    const ambiguous = await syncKnowledge(config, missing.entries);
    assert.match(ambiguous.entries.find(entry => entry.sourceId === 'synthetic-source')!.error!, /ambiguous/);
    assert.doesNotMatch(JSON.stringify(ambiguous), /PRIVATE_MATCH/);
    assert.equal(searchKnowledge(ambiguous.entries, '').length, 1);
  });
});

test('section boundaries respect setext headings and ignore commented and tilde-fenced headings', async () => {
  await fixture(async workspace => {
    const path = join(workspace, 'MEMORY.md');
    await writeFile(path, [
      '<!--', '# Selected', 'COMMENTED_PRIVATE', '-->',
      'Selected', '========', 'Relevant paragraph.',
      '~~~md', '# Another section', 'A literal example.', '~~~',
      'Nested', '------', 'Relevant nested paragraph.',
      'Unrelated', '=========', 'PRIVATE_AFTER_SECTION',
    ].join('\n'));
    const result = await syncKnowledge(project(workspace, [source(path, { section: 'Selected' })]), []);
    assert.equal(result.stats.errors, 0);
    assert.match(result.entries[0].content, /Relevant nested paragraph/);
    assert.match(result.entries[0].content, /A literal example/);
    assert.doesNotMatch(result.entries[0].content, /PRIVATE/);
  });
});

test('entry identity and revision remain stable until selected content changes', async () => {
  await fixture(async workspace => {
    const path = join(workspace, 'design.md');
    await writeFile(path, '# Design\nOriginal decision.\n');
    const config = project(workspace, [source('design.md')]);
    const first = await syncKnowledge(config, []);
    const unchanged = await syncKnowledge(config, first.entries);
    assert.equal(unchanged.entries[0].id, first.entries[0].id);
    assert.equal(unchanged.entries[0].hash, first.entries[0].hash);
    assert.equal(unchanged.entries[0].revision, 1);
    assert.equal(unchanged.stats.unchanged, 1);
    await writeFile(path, '# Design\nRevised decision.\n');
    const changed = await syncKnowledge(config, unchanged.entries);
    assert.equal(changed.entries[0].id, first.entries[0].id);
    assert.notEqual(changed.entries[0].hash, first.entries[0].hash);
    assert.equal(changed.entries[0].revision, 2);
    assert.equal(changed.stats.changed, 1);
    assert.match(first.entries[0].content, /Original decision/);
  });
});

test('missing files retain provenance and revision but cannot contribute current context', async () => {
  await fixture(async workspace => {
    const path = join(workspace, 'design.txt');
    await writeFile(path, 'A previous decision.');
    const config = project(workspace, [source(path)]);
    const first = await syncKnowledge(config, []);
    await unlink(path);
    const missing = await syncKnowledge(config, first.entries);
    assert.equal(missing.stats.missing, 1);
    assert.equal(missing.entries[0].status, 'missing');
    assert.equal(missing.entries[0].id, first.entries[0].id);
    assert.equal(missing.entries[0].revision, 1);
    assert.equal(missing.entries[0].sourcePath, path);
    assert.equal(missing.entries[0].content, 'A previous decision.');
    assert.deepEqual(searchKnowledge(missing.entries, 'decision'), []);
    const initiallyMissing = await syncKnowledge(project(workspace, [source('never-created.md')]), []);
    assert.equal(initiallyMissing.stats.missing, 1);
    assert.equal(initiallyMissing.entries[0].content, '');
  });
});

test('a failed sync preserves the earlier revision and a successful retry restores current context', async () => {
  await fixture(async workspace => {
    const path = join(workspace, 'decision.md');
    await writeFile(path, '# Decision\nThe reviewed choice.');
    const config = project(workspace, [source(path)]);
    const first = await syncKnowledge(config, []);
    await writeFile(path, Buffer.from([0, 1, 2]));
    const failed = await syncKnowledge(config, first.entries);
    assert.equal(failed.entries[0].status, 'error');
    assert.equal(failed.entries[0].revision, 1);
    assert.match(failed.entries[0].content, /reviewed choice/);
    assert.deepEqual(searchKnowledge(failed.entries, ''), []);
    await writeFile(path, '# Decision\nThe reviewed choice.');
    const recovered = await syncKnowledge(config, failed.entries);
    assert.equal(recovered.entries[0].status, 'current');
    assert.equal(recovered.entries[0].revision, 1);
    assert.equal(recovered.entries[0].error, undefined);
    assert.equal(recovered.stats.unchanged, 1);
  });
});

test('removing a source retires its entries while preserving project lessons and rejecting foreign entries', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'guide.md'), '# Guide\nObsolete source context.');
    const first = await syncKnowledge(project(workspace, [source('guide.md')]), []);
    const retainedLesson = lesson();
    const removed = await syncKnowledge(project(workspace, []), [...first.entries, retainedLesson, lesson({ id: 'foreign', projectId: 'other-project' })]);
    assert.equal(removed.entries.length, 2);
    assert.equal(removed.entries.find(entry => entry.id === first.entries[0].id)!.status, 'missing');
    assert.deepEqual(searchKnowledge(removed.entries, ''), [retainedLesson]);
    assert.equal(removed.stats.missing, 1);
  });
});

test('directory traversal accepts a deliberate local report root and excludes nested generated/private paths', async () => {
  await fixture(async workspace => {
    const root = join(workspace, '.local', 'reports');
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, 'overview.md'), '# Review\nAn intentionally selected local report.');
    await writeFile(join(root, 'nested', 'result.txt'), 'A nested report.');
    await writeFile(join(root, 'nested', 'format.rst'), 'A plain reStructuredText report.');
    for (const directory of ['.git', 'node_modules', 'cache', 'caches', '.cache', '.config', '.hidden']) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(join(root, directory, 'ignored.md'), 'PRIVATE_EXCLUDED_CONTENT');
    }
    await writeFile(join(root, 'runtime.json'), '{"synthetic":"PRIVATE_UNSUPPORTED_CONTENT"}');
    await writeFile(join(root, 'credentials.txt'), 'PRIVATE_CREDENTIAL_CONTENT');
    const result = await syncKnowledge(project(workspace, [source(root, { kind: 'artifact' })]), []);
    assert.equal(result.stats.added, 3);
    assert.equal(result.stats.errors, 1);
    assert.equal(searchKnowledge(result.entries, '').length, 3);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    assert.ok(result.entries.every(entry => entry.sourcePath!.startsWith(root)));
    const snapshots = structuredClone(result.entries);
    await unlink(join(root, 'nested', 'result.txt'));
    const resynced = await syncKnowledge(project(workspace, [source(root, { kind: 'artifact' })]), result.entries);
    assert.equal(resynced.stats.missing, 1);
    assert.equal(resynced.stats.unchanged, 2);
    assert.deepEqual(result.entries, snapshots);
  });
});

test('explicit adopted workflow artifacts synchronize as text with their role tags and content hash', async () => {
  await fixture(async workspace => {
    const directory = join(workspace, '.github', 'workflows');
    await mkdir(directory, { recursive: true });
    const roles = ['development', 'qa'];
    const workflows = [
      { name: 'ci.yml', content: 'name: Synthetic checks\non: push\njobs: {}' },
      { name: 'review.yaml', content: 'name: Synthetic review\non: workflow_dispatch\njobs: {}' },
    ];
    for (const workflow of workflows) await writeFile(join(directory, workflow.name), workflow.content);
    const config = project(workspace, workflows.map((workflow, index) => source(join(directory, workflow.name), {
      id: `adopted-workflow-${index}`, kind: 'artifact', roles,
    })));
    const first = await syncKnowledge(config, []);
    assert.deepEqual(first.stats, { added: 2, changed: 0, unchanged: 0, missing: 0, errors: 0 });
    for (const [index, workflow] of workflows.entries()) {
      const entry = first.entries.find(item => item.sourceId === `adopted-workflow-${index}`)!;
      assert.equal(entry.status, 'current');
      assert.equal(entry.kind, 'artifact');
      assert.deepEqual(entry.roles, roles);
      assert.equal(entry.title, workflow.name);
      assert.equal(entry.content, workflow.content);
      assert.equal(entry.sourcePath, join(directory, workflow.name));
      const hash = createHash('sha256').update(workflow.content).digest('hex');
      assert.equal(entry.hash, hash);
      assert.equal(entry.sourceRevision, `sha256:${hash}`);
      assert.equal(entry.revision, 1);
    }
    const unchanged = await syncKnowledge(config, first.entries);
    assert.equal(unchanged.stats.unchanged, 2);
    assert.deepEqual(unchanged.entries.map(entry => [entry.id, entry.hash, entry.revision]), first.entries.map(entry => [entry.id, entry.hash, entry.revision]));
    assert.equal(searchKnowledge(first.entries, 'Synthetic', 'qa', 'artifact').length, 2);
  });
});

test('the workflow exception rejects other YAML, credential paths and non-artifact registrations', async () => {
  await fixture(async workspace => {
    const directory = join(workspace, '.github', 'workflows');
    await mkdir(join(directory, 'nested'), { recursive: true });
    const paths = ['runtime.yaml', '.github/settings.yml', '.github/workflows/credentials.yml', '.github/workflows/nested/ci.yml'];
    for (const path of paths) await writeFile(join(workspace, path), 'PRIVATE_UNSUPPORTED_YAML');
    const workflow = join(directory, 'ci.yml');
    await writeFile(workflow, 'name: A workflow requiring an explicit artifact registration');
    const config = project(workspace, [
      ...paths.map((path, index) => source(join(workspace, path), { id: `unsupported-${index}`, kind: 'artifact' })),
      source(workflow, { id: 'wrong-kind-document', kind: 'document' }),
      source(workflow, { id: 'wrong-kind-memory', kind: 'memory' }),
    ]);
    const result = await syncKnowledge(config, []);
    assert.equal(result.stats.added, 0);
    assert.equal(result.stats.errors, 6);
    assert.ok(result.entries.every(entry => entry.status === 'error' && entry.content === ''));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UNSUPPORTED_YAML/);
  });
});

test('directory discovery does not adopt workflow YAML through the explicit-file exception', async () => {
  await fixture(async workspace => {
    const directory = join(workspace, '.github', 'workflows');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'ci.yml'), 'UNSELECTED_WORKFLOW_YAML');
    await writeFile(join(directory, 'review.yaml'), 'UNSELECTED_WORKFLOW_YAML');
    await writeFile(join(directory, 'README.md'), '# Workflow notes\nAn ordinary text source.');
    const result = await syncKnowledge(project(workspace, [source(directory, { kind: 'artifact' })]), []);
    assert.deepEqual(result.stats, { added: 1, changed: 0, unchanged: 0, missing: 0, errors: 0 });
    assert.equal(result.entries[0].title, 'Workflow notes');
    assert.doesNotMatch(JSON.stringify(result), /UNSELECTED_WORKFLOW_YAML/);
  });
});

test('symlink escapes cannot import outside content and do not prevent safe siblings from syncing', async () => {
  await fixture(async workspace => {
    const root = join(workspace, 'documents');
    await mkdir(root);
    const outsideFile = join(workspace, 'outside.md');
    const outsideDirectory = join(workspace, 'outside-directory');
    await mkdir(outsideDirectory);
    await writeFile(outsideFile, '# Outside\nPRIVATE_OUTSIDE_FILE');
    await writeFile(join(outsideDirectory, 'outside.md'), '# Outside\nPRIVATE_OUTSIDE_DIRECTORY');
    await writeFile(join(root, 'safe.md'), '# Safe\nAn ordinary document.');
    await symlink(outsideFile, join(root, 'escape.md'));
    await symlink(outsideDirectory, join(root, 'escape-directory'));
    const result = await syncKnowledge(project(workspace, [source(root)]), []);
    assert.equal(result.stats.added, 1);
    assert.equal(result.stats.errors, 2);
    assert.equal(searchKnowledge(result.entries, '').length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OUTSIDE/);
    const directLink = await syncKnowledge(project(workspace, [source(join(root, 'escape.md'))]), []);
    assert.equal(directLink.stats.errors, 1);
    assert.doesNotMatch(JSON.stringify(directLink), /PRIVATE_OUTSIDE/);
  });
});

test('a file link retargeted outside the source retires its earlier current context', async () => {
  await fixture(async workspace => {
    const root = join(workspace, 'documents');
    await mkdir(root);
    await writeFile(join(root, 'reviewed.md'), '# Reviewed\nA scoped choice.');
    const link = join(root, 'alias.md');
    await symlink(join(root, 'reviewed.md'), link);
    const config = project(workspace, [source(root)]);
    const first = await syncKnowledge(config, []);
    assert.equal(first.stats.added, 2);
    const outside = join(workspace, 'outside.md');
    await writeFile(outside, '# Outside\nPRIVATE_RETARGET_CONTENT');
    await unlink(link);
    await symlink(outside, link);
    const changed = await syncKnowledge(config, first.entries);
    assert.equal(changed.stats.errors, 1);
    assert.equal(changed.stats.unchanged, 1);
    assert.equal(searchKnowledge(changed.entries, '').length, 1);
    assert.doesNotMatch(JSON.stringify(changed), /PRIVATE_RETARGET_CONTENT/);
  });
});

test('directory scans enforce depth bounds and reject generated roots without reading their contents', async () => {
  await fixture(async workspace => {
    const root = join(workspace, 'reports');
    await mkdir(root);
    await writeFile(join(root, 'a-safe.txt'), 'A bounded report.');
    const deep = join(root, ...Array.from({ length: 22 }, () => 'nested'));
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'deep.md'), 'PRIVATE_TOO_DEEP');
    const result = await syncKnowledge(project(workspace, [source(root)]), []);
    assert.ok(result.stats.errors > 0);
    assert.equal(result.stats.added, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOO_DEEP/);
    const generated = join(workspace, 'node_modules');
    await mkdir(generated);
    await writeFile(join(generated, 'unsafe.txt'), 'PRIVATE_GENERATED_ROOT');
    const rejected = await syncKnowledge(project(workspace, [source(generated)]), []);
    assert.equal(rejected.stats.errors, 1);
    assert.equal(rejected.stats.added, 0);
    assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE_GENERATED_ROOT/);
  });
});

test('unsupported, credential, oversized and binary files fail independently', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'valid.txt'), 'A safe source.');
    await writeFile(join(workspace, 'config.txt'), 'PRIVATE_RUNTIME_CONFIGURATION');
    await writeFile(join(workspace, '.env.txt'), 'PRIVATE_ENV_CONFIGURATION');
    await writeFile(join(workspace, 'credential.json'), '{"synthetic":"PRIVATE_CREDENTIAL"}');
    await writeFile(join(workspace, 'large.md'), 'x'.repeat(1024 * 1024 + 1));
    await writeFile(join(workspace, 'binary.md'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(workspace, 'encoding.txt'), Buffer.from([0xff, 0xfe, 0x80]));
    await writeFile(join(workspace, 'key-example.txt'), '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_INVALID_TEST_MATERIAL\n-----END PRIVATE KEY-----');
    const paths = ['valid.txt', 'config.txt', '.env.txt', 'credential.json', 'large.md', 'binary.md', 'encoding.txt', 'key-example.txt'];
    const result = await syncKnowledge(project(workspace, paths.map((path, index) => source(path, { id: `source-${index}` }))), []);
    assert.equal(result.stats.added, 1);
    assert.equal(result.stats.errors, 7);
    assert.equal(searchKnowledge(result.entries, '').length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|x{20}|SYNTHETIC_INVALID_TEST_MATERIAL/);
  });
});

test('search filters roles and kinds, excludes stale entries and supports English/Chinese substrings', () => {
  const entries = [
    lesson({ id: 'shared' }),
    lesson({ id: 'developer', title: 'Retry cycle', content: 'Bound the RETRY stage. 重试阶段需要限制。', roles: ['developer'], kind: 'document' }),
    lesson({ id: 'reviewer', title: 'Review evidence', content: 'Preserve retry evidence. 保留证据。', roles: ['reviewer'], kind: 'memory' }),
    lesson({ id: 'stale', content: 'RETRY 证据', status: 'error' }),
    lesson({ id: 'missing', content: 'RETRY 证据', status: 'missing' }),
  ];
  assert.deepEqual(searchKnowledge(entries, 'retry', 'developer').map(entry => entry.id), ['developer', 'shared']);
  assert.deepEqual(searchKnowledge(entries, '证据', 'reviewer', 'memory').map(entry => entry.id), ['reviewer']);
  assert.deepEqual(searchKnowledge(entries, '重试', 'developer', 'document').map(entry => entry.id), ['developer']);
  assert.deepEqual(searchKnowledge(entries, 'retry stage', 'developer').map(entry => entry.id), ['developer']);
  assert.deepEqual(searchKnowledge(entries, 'ＲＥＴＲＹ', 'developer', 'document').map(entry => entry.id), ['developer']);
  assert.deepEqual(searchKnowledge(entries, '', 'reviewer').map(entry => entry.id), ['shared', 'reviewer']);
  assert.deepEqual(searchKnowledge(entries, '', 'developer', 'unknown'), []);
  assert.deepEqual(entries.map(entry => entry.id), ['shared', 'developer', 'reviewer', 'stale', 'missing']);
});

test('archived lessons retain their evidence through synchronization and only explicit management search includes them',async()=>{
  await fixture(async workspace=>{
    const archived=lesson({id:'archived-lesson',status:'archived',lifecycleRevision:3}),current=lesson({id:'current-lesson'}),sourceEntry=lesson({id:'synthetic-source-entry',kind:'document',status:'archived'}),before=structuredClone(archived);
    const result=await syncKnowledge(project(workspace,[]),[archived,current]);
    assert.deepEqual(result.entries.find(entry=>entry.id===archived.id),before);assert.deepEqual(archived,before);
    assert.deepEqual(searchKnowledge(result.entries,'').map(entry=>entry.id),[current.id]);
    assert.deepEqual(searchKnowledge([...result.entries,sourceEntry],'review',undefined,undefined,'archived').map(entry=>entry.id),[archived.id]);
    assert.deepEqual(searchKnowledge(result.entries,'限制',undefined,'lesson','archived').map(entry=>entry.id),[archived.id]);
    assert.deepEqual(searchKnowledge(result.entries,'',undefined,'document','archived'),[]);
  });
});

test('only registered project-root AGENTS gets the guidance default and explicit owner purpose wins',async()=>{
  await fixture(async directory=>{
    const workspace=join(directory,'project'),external=join(directory,'external');await mkdir(workspace);await mkdir(external);await mkdir(join(workspace,'nested'));
    for(const file of [join(workspace,'AGENTS.md'),join(workspace,'nested','AGENTS.md'),join(external,'AGENTS.md')])await writeFile(file,'# Guide\nPreserve the original scope.');
    const sources=[source(join(workspace,'AGENTS.md'),{id:'root'}),source(join(workspace,'nested','AGENTS.md'),{id:'nested'}),source(join(external,'AGENTS.md'),{id:'external'}),source(join(workspace,'AGENTS.md'),{id:'explicit-reference',purpose:'reference'})];
    const result=await syncKnowledge(project(workspace,sources),[]),bySource=new Map(result.entries.map(entry=>[entry.sourceId,entry]));
    assert.equal(bySource.get('root')?.purpose,'guidance');assert.equal(bySource.get('root')?.purposeOrigin,'project-root-default');assert.equal(bySource.get('nested')?.purpose,'reference');assert.equal(bySource.get('external')?.purpose,'reference');assert.equal(bySource.get('explicit-reference')?.purpose,'reference');assert.equal(bySource.get('explicit-reference')?.purposeOrigin,'owner');
    const controller=new AbortController();controller.abort();await assert.rejects(syncKnowledge(project(workspace,sources),[],{signal:controller.signal}),{name:'AbortError'});
  });
});
