import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import type { Actor, KnowledgeEntry, KnowledgeSource, KnowledgeSyncResult, Project } from './contracts.ts';
import type {Store} from './store.ts';
import {demand,isObject,text} from './validation.ts';
import type {KnowledgeFeedback,KnowledgeFeedbackInput,KnowledgeReference,KnowledgeRelationship,KnowledgeRelationshipInput,LessonReviewInput} from './knowledge-context-types.ts';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_PATHS = 2000;
const MAX_DEPTH = 20;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.rst']);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', 'node_modules', '.cache', 'cache', 'caches', '.next', '.vite', '.turbo',
  '.venv', 'venv', 'coverage', '.ssh', '.aws', '.azure', '.gnupg', 'keychains',
  'credentials', '.config',
]);
const CREDENTIAL_DIRECTORIES = new Set(['.ssh', '.aws', '.azure', '.gnupg', 'keychains', 'credentials', '.config']);

class SourceError extends Error {
  readonly missing: boolean;
  readonly incomplete: boolean;

  constructor(message: string, missing = false, incomplete = false) {
    super(message);
    this.missing = missing;
    this.incomplete = incomplete;
  }
}

type Heading = { line: number; level: number; title: string };

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function entryId(projectId: string, sourceId: string, sourceRelativePath: string): string {
  return `knowledge-${hashContent(JSON.stringify([projectId, sourceId, sourceRelativePath])).slice(0, 24)}`;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function isCredentialPath(path: string): boolean {
  if (path.split(sep).some(part => CREDENTIAL_DIRECTORIES.has(part.toLowerCase()))) return true;
  const name = basename(path).toLowerCase();
  return /^\.?env(?:[._-]|$)/.test(name)
    || /(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?|auth(?:entication)?|private[-_]?key)(?:$|[._-])/.test(name)
    || /^(?:\.?config|settings)(?:\.[^.]+)?$/.test(name)
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(name)
    || /\.(?:pem|key|p12|pfx|kdbx|keychain(?:-db)?)$/.test(name);
}

function isWorkflowFile(path: string): boolean {
  const parts = path.split(sep);
  return parts.at(-3) === '.github' && parts.at(-2) === 'workflows'
    && ['.yml', '.yaml'].includes(extname(path).toLowerCase());
}

/** Pure path eligibility; realpath, file, content and size checks still apply when reading. */
export function isKnowledgePathEligible(path: string, kind: KnowledgeSource['kind']): boolean {
  return !isCredentialPath(path) && (TEXT_EXTENSIONS.has(extname(path).toLowerCase()) || kind === 'artifact' && isWorkflowFile(path));
}

function readableError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') return new SourceError('Source path is missing.', true);
  return new SourceError(code ? `Source could not be read (${code}).` : 'Source could not be read.');
}

function markdownHeadings(content: string): Heading[] {
  const lines = content.split('\n');
  const headings: Heading[] = [];
  let fence: { character: string; length: number } | undefined;
  let comment = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (comment) {
      if (line.includes('-->')) comment = false;
      continue;
    }
    if (!fence && line.includes('<!--')) {
      if (!line.slice(line.indexOf('<!--') + 4).includes('-->')) comment = true;
      continue;
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[\t ]+|$)(.*)$/);
    if (atx) {
      headings.push({ line: index, level: atx[1].length, title: atx[2].replace(/[\t ]+#+[\t ]*$/, '').trim() });
      continue;
    }
    if (line.trim() && !/^ {4}|^\t/.test(line) && index + 1 < lines.length) {
      const setext = lines[index + 1].match(/^ {0,3}(=+|-+)[\t ]*$/);
      if (setext) {
        headings.push({ line: index, level: setext[1][0] === '=' ? 1 : 2, title: line.trim() });
        index++;
      }
    }
  }
  return headings;
}

function selectContent(content: string, source: KnowledgeSource, path: string): { content: string; title: string; sourceLineStart:number } {
  const headings = extname(path).toLowerCase() === '.md' ? markdownHeadings(content) : [];
  if (source.section !== undefined) {
    if (extname(path).toLowerCase() !== '.md') throw new SourceError('A section selector requires a Markdown file.');
    const matches = headings.filter(heading => heading.title === source.section);
    if (matches.length === 0) throw new SourceError('The selected Markdown section is missing.');
    if (matches.length > 1) throw new SourceError('The selected Markdown section is ambiguous.');
    const heading = matches[0];
    const end = headings.find(next => next.line > heading.line && next.level <= heading.level)?.line;
    return { content: content.split('\n').slice(heading.line, end).join('\n').trimEnd(), title: heading.title,sourceLineStart:heading.line+1 };
  }
  return { content: content.trimEnd(), title: headings[0]?.title || basename(path),sourceLineStart:1 };
}

async function readText(path: string, root: string, budget: { bytes: number }, explicitWorkflowArtifact = false): Promise<{ text: string; sourcePath: string }> {
  const before = await realpath(path);
  if (!isWithin(root, before)) throw new SourceError('A symbolic link leaves the configured source root.');
  if (isCredentialPath(before)) throw new SourceError('Credential and runtime configuration files cannot be indexed.');
  if (!isKnowledgePathEligible(before, explicitWorkflowArtifact ? 'artifact' : 'document')) {
    throw new SourceError('Use Markdown, text, reStructuredText or an explicitly registered workflow artifact.');
  }
  const handle = await open(before, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new SourceError('The source is not a regular text file.');
    if (info.size > MAX_FILE_BYTES) throw new SourceError('Source file exceeds the 1 MiB limit.');
    if (budget.bytes + info.size > MAX_SOURCE_BYTES) throw new SourceError('Source exceeds the 16 MiB synchronization limit.', false, true);
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_FILE_BYTES) throw new SourceError('Source file exceeds the 1 MiB limit.');
    if (budget.bytes + length > MAX_SOURCE_BYTES) throw new SourceError('Source exceeds the 16 MiB synchronization limit.', false, true);
    const after = await realpath(path);
    const afterInfo = await stat(after);
    if (before !== after || !isWithin(root, after) || info.dev !== afterInfo.dev || info.ino !== afterInfo.ino
      || info.size !== afterInfo.size || info.mtimeMs !== afterInfo.mtimeMs || info.ctimeMs !== afterInfo.ctimeMs) {
      throw new SourceError('Source changed during synchronization; synchronize again.');
    }
    budget.bytes += length;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    } catch {
      throw new SourceError('Source is not valid UTF-8 text.');
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new SourceError('Binary content cannot be indexed.');
    if (/-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text)) {
      throw new SourceError('Private key material cannot be indexed.');
    }
    return { text: text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), sourcePath: before };
  } finally {
    await handle.close();
  }
}

/** Synchronize only explicitly registered sources; callers persist the returned state. */
export async function syncKnowledge(project: Project, previous: KnowledgeEntry[],options:{signal?:AbortSignal}={}): Promise<KnowledgeSyncResult> {
  options.signal?.throwIfAborted();
  const syncedAt = new Date().toISOString();
  const stats: KnowledgeSyncResult['stats'] = { added: 0, changed: 0, unchanged: 0, missing: 0, errors: 0 };
  const projectPrevious = previous.filter(entry => entry.projectId === project.id);
  const previousById = new Map(projectPrevious.map(entry => [entry.id, entry]));
  const result = new Map<string, KnowledgeEntry>();
  for (const entry of projectPrevious.filter(entry => entry.kind === 'lesson')) result.set(entry.id, { ...entry, roles: [...entry.roles] });
  const configuredSources = new Set(project.knowledgeSources.map(source => source.id));
  const homeRoot = await realpath(homedir()).catch(() => resolve(homedir()));
  const workspaceRoot=await realpath(project.workspace).catch(()=>resolve(project.workspace));

  for (const source of project.knowledgeSources) {
    options.signal?.throwIfAborted();
    const rootGuides=new Set([resolve(project.workspace,'AGENTS.md'),resolve(workspaceRoot,'AGENTS.md')]);
    const purpose=(filename:string)=>({purpose:source.purpose??(rootGuides.has(resolve(filename))?'guidance' as const:'reference' as const),purposeOrigin:source.purpose?'owner' as const:rootGuides.has(resolve(filename))?'project-root-default' as const:'reference-default' as const});
    const declaredRoot = resolve(project.workspace, source.path);
    const sourcePrevious = projectPrevious.filter(entry => entry.sourceId === source.id && entry.kind !== 'lesson');
    const seen = new Set<string>();
    const roles = [...new Set(source.roles)];
    let sourceFailure: SourceError | undefined;
    let directorySource = false;
    const budget = { bytes: 0, paths: 0 };

    function retainFailure(path: string, sourceRelativePath: string, error: SourceError): void {
      const id = entryId(project.id, source.id, sourceRelativePath);
      const prior = previousById.get(id);
      const entry: KnowledgeEntry = {
        id, projectId: project.id, sourceId: source.id, kind: source.kind, roles: [...roles],
        title: prior?.title || source.section || basename(path), content: prior?.content || '',
        hash: prior?.hash || hashContent(''), revision: prior?.revision || 1,
        sourcePath: prior?.sourcePath || path, sourceRevision: prior?.sourceRevision,
        syncedAt, status: error.missing ? 'missing' : 'error', error: error.message,...purpose(prior?.sourcePath??path),sourceLineStart:prior?.sourceLineStart??1,
      };
      result.set(id, entry);
      seen.add(id);
      stats[error.missing ? 'missing' : 'errors']++;
    }

    async function indexFile(path: string, sourceRelativePath: string, root: string): Promise<void> {
      try {
        options.signal?.throwIfAborted();
        if (isCredentialPath(path)) throw new SourceError('Credential and runtime configuration files cannot be indexed.');
        const read = await readText(path, root, budget, sourceRelativePath === '.' && source.kind === 'artifact' && isWorkflowFile(path));
        options.signal?.throwIfAborted();
        const selected = selectContent(read.text, source, path);
        const id = entryId(project.id, source.id, sourceRelativePath);
        const prior = previousById.get(id);
        const hash = hashContent(selected.content);
        const entry: KnowledgeEntry = {
          id, projectId: project.id, sourceId: source.id, kind: source.kind, roles: [...roles],
          title: selected.title, content: selected.content, hash,
          revision: prior ? prior.revision + Number(prior.hash !== hash) : 1,
          sourcePath: read.sourcePath, sourceRevision: `sha256:${hashContent(read.text)}`, syncedAt, status: 'current',sourceLineStart:selected.sourceLineStart,...purpose(read.sourcePath),
        };
        result.set(id, entry);
        seen.add(id);
        stats[!prior ? 'added' : prior.hash === hash ? 'unchanged' : 'changed']++;
      } catch (error) {
        options.signal?.throwIfAborted();
        const problem = readableError(error);
        if (problem.incomplete) throw problem;
        retainFailure(path, sourceRelativePath, problem);
      }
    }

    async function walk(path: string, root: string, depth: number): Promise<void> {
      if (depth > MAX_DEPTH) throw new SourceError('Source directory exceeds the nesting limit.', false, true);
      const entries = [];
      const directory = await opendir(path);
      for await (const entry of directory) {
        if (++budget.paths > MAX_SOURCE_PATHS) throw new SourceError('Source directory exceeds the 2000-path limit.', false, true);
        entries.push(entry);
      }
      entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const entry of entries) {
        const candidate = resolve(path, entry.name);
        const sourceRelativePath = relative(root, candidate);
        const name = entry.name.toLowerCase();
        if (EXCLUDED_DIRECTORIES.has(name) || entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          try {
            const resolved = await realpath(candidate);
            if (!isWithin(root, resolved)) throw new SourceError('A symbolic link leaves the configured source root.');
            await walk(candidate, root, depth + 1);
          } catch (error) {
            const problem = readableError(error);
            if (problem.incomplete) throw problem;
            retainFailure(candidate, sourceRelativePath, problem);
            sourceFailure = problem;
          }
        } else if (entry.isSymbolicLink()) {
          try {
            const resolved = await realpath(candidate);
            if (!isWithin(root, resolved)) throw new SourceError('A symbolic link leaves the configured source root.');
            const info = await stat(resolved);
            if (info.isDirectory()) throw new SourceError('Symbolic directory links cannot be indexed.');
            if (TEXT_EXTENSIONS.has(extname(candidate).toLowerCase())) await indexFile(candidate, sourceRelativePath, root);
          } catch (error) {
            const problem = readableError(error);
            if (problem.incomplete) throw problem;
            retainFailure(candidate, sourceRelativePath, problem);
          }
        } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(candidate).toLowerCase())) {
          await indexFile(candidate, sourceRelativePath, root);
        }
      }
    }

    try {
      if (isCredentialPath(declaredRoot)) throw new SourceError('Credential and runtime configuration files cannot be indexed.');
      const declaredInfo = await lstat(declaredRoot);
      if (declaredInfo.isSymbolicLink()) throw new SourceError('Register the direct source path rather than a symbolic link.');
      const root = await realpath(declaredRoot);
      if (isCredentialPath(root)) throw new SourceError('Credential and runtime configuration files cannot be indexed.');
      const info = await stat(root);
      if (info.isDirectory()) {
        directorySource = true;
        if (root === parse(root).root || isWithin(root, homeRoot) || basename(root) === '.codex') {
          throw new SourceError('Register a focused source directory rather than a home or agent-history root.');
        }
        if (EXCLUDED_DIRECTORIES.has(basename(root).toLowerCase())) throw new SourceError('Generated and dependency directories cannot be indexed.');
        if (source.section !== undefined) throw new SourceError('A section selector requires one explicit Markdown file.');
        await walk(root, root, 0);
      } else if (info.isFile()) {
        await indexFile(root, '.', root);
      } else {
        throw new SourceError('The source is not a regular file or directory.');
      }
    } catch (error) {
      sourceFailure = readableError(error);
      if (sourcePrevious.length === 0 && !seen.has(entryId(project.id, source.id, '.'))) retainFailure(declaredRoot, '.', sourceFailure);
    }

    for (const prior of sourcePrevious) {
      if (seen.has(prior.id)) continue;
      if (directorySource && !sourceFailure && prior.id === entryId(project.id, source.id, '.')) continue;
      const problem = sourceFailure || new SourceError('Source file is no longer present in this source.', true);
      result.set(prior.id, { ...prior, roles: [...roles], kind: source.kind, syncedAt, status: problem.missing ? 'missing' : 'error', error: problem.message });
      stats[problem.missing ? 'missing' : 'errors']++;
    }
  }

  for (const prior of projectPrevious) {
    if (prior.kind === 'lesson' || configuredSources.has(prior.sourceId)) continue;
    result.set(prior.id, { ...prior, roles: [...prior.roles], syncedAt, status: 'missing', error: 'Source is no longer configured.' });
    stats.missing++;
  }
  const entries = [...result.values()].sort((left, right) => {
    const leftKey = `${left.sourceId}\0${left.sourcePath || ''}\0${left.id}`;
    const rightKey = `${right.sourceId}\0${right.sourcePath || ''}\0${right.id}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  options.signal?.throwIfAborted();return { entries, stats };
}

/** Search current project entries with deterministic, Unicode-aware substring matching. */
export function searchKnowledge(entries: KnowledgeEntry[], query: string, role?: string, kind?: string, status:'current'|'archived'|'proposed'|'declined'='current'): KnowledgeEntry[] {
  const normalize = (text: string): string => text.normalize('NFKC').toLowerCase();
  const phrase = normalize(query).trim();
  const terms = phrase.split(/\s+/).filter(Boolean);
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (status==='current'?entry.status==='current':entry.kind==='lesson'&&entry.status===status)
      && (!role || entry.roles.length === 0 || entry.roles.includes(role))
      && (!kind || entry.kind === kind))
    .map(({ entry, index }) => {
      const title = normalize(entry.title);
      const content = normalize(entry.content);
      const text = `${title}\n${content}`;
      const matches = terms.every(term => text.includes(term));
      const score = phrase ? Number(title.includes(phrase)) * 100 + Number(content.includes(phrase)) * 20
        + terms.filter(term => title.includes(term)).length * 5 : 0;
      return { entry, index, matches, score };
    })
    .filter(result => result.matches)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(result => result.entry);
}

function knowledgeReference(store:Store,projectId:string,value:unknown):KnowledgeReference{
  demand(isObject(value)&&text(value.entryId,160)&&Number.isSafeInteger(value.revision)&&Number(value.revision)>0&&text(value.hash,160)&&(value.corpusId===undefined||text(value.corpusId,160)),'INVALID_KNOWLEDGE_REFERENCE','Name an exact entry revision and hash.');
  const reference=value as KnowledgeReference;
  const corpus=reference.corpusId?store.get<{manifest:{projectId:string};entries:KnowledgeEntry[]}>('knowledge-corpus',reference.corpusId):null;
  const entry=reference.corpusId?(corpus?.manifest.projectId===projectId?corpus.entries.find(entry=>entry.projectId===projectId&&entry.id===reference.entryId):undefined):store.get<KnowledgeEntry>('knowledge',reference.entryId);
  demand(entry&&entry.projectId===projectId&&entry.revision===reference.revision&&entry.hash===reference.hash,'KNOWLEDGE_REFERENCE_CHANGED','This evidence is unavailable or belongs to another revision/project.',409);
  return{entryId:reference.entryId,revision:reference.revision,hash:reference.hash,...(reference.corpusId?{corpusId:reference.corpusId}:{})};
}
export function effectiveKnowledgeRelationships(values:KnowledgeRelationship[]):KnowledgeRelationship[]{
  const result=new Map<string,KnowledgeRelationship>();
  for(const value of values){const refs=[JSON.stringify([value.from.entryId,value.from.revision,value.from.hash]),JSON.stringify([value.to.entryId,value.to.revision,value.to.hash])];if(value.kind==='conflicts')refs.sort();const key=JSON.stringify([value.kind,...refs]);const prior=result.get(key);if(!prior||value.revision>prior.revision)result.set(key,value);}
  return[...result.values()];
}
export function recordKnowledgeFeedback(store:Store,projectId:string,input:KnowledgeFeedbackInput,actor:Actor,origin?:{runId:string;roleId:string}):KnowledgeFeedback{
  demand(isObject(input)&&['relevant','irrelevant','outdated','conflict'].includes(input.kind)&&(!input.note||text(input.note,4000))&&(input.selectionId===undefined||text(input.selectionId,160)),'INVALID_KNOWLEDGE_FEEDBACK','Describe relevance, obsolescence or conflict with bounded evidence.');
  demand(input.evidence===undefined||Array.isArray(input.evidence)&&input.evidence.length<=20,'INVALID_KNOWLEDGE_FEEDBACK','Keep the evidence list bounded.');const reference=knowledgeReference(store,projectId,input.reference),evidence=(input.evidence??[]).map(value=>knowledgeReference(store,projectId,value));
  if(input.selectionId){const selection=store.get<{plan:{scope:{projectId:string;runId:string}}}>('knowledge-context',input.selectionId);demand(selection?.plan.scope.projectId===projectId&&(!origin||selection.plan.scope.runId===origin.runId),'KNOWLEDGE_SCOPE','Use a selection from this originating work.',403);}
  const result:KnowledgeFeedback={id:randomUUID(),projectId,at:new Date().toISOString(),actor:actor.name,status:'recorded',kind:input.kind,reference,evidence,...(input.note?{note:input.note}:{}),...(input.selectionId?{selectionId:input.selectionId}:{}),...(origin?{originRunId:origin.runId,roleId:origin.roleId}:{})};
  store.transaction(()=>{store.put('knowledge-feedback',result);store.event({projectId,runId:origin?.runId??null,stageId:null,type:'knowledge.feedback',actor:actor.name,message:'Evidence-linked knowledge feedback recorded; no frozen context or ranking was changed.',data:{feedbackId:result.id,kind:result.kind,reference}});});return result;
}
export function recordKnowledgeRelationship(store:Store,projectId:string,input:KnowledgeRelationshipInput,actor:Actor):KnowledgeRelationship{
  demand(!actor.projectId,'OWNER_REQUIRED','Knowledge relationships require owner review.',403);demand(isObject(input)&&['supersedes','conflicts'].includes(input.kind)&&(input.resolved===undefined||typeof input.resolved==='boolean'),'INVALID_KNOWLEDGE_RELATIONSHIP','Name an explicit supersession or conflict.');
  const from=knowledgeReference(store,projectId,input.from),to=knowledgeReference(store,projectId,input.to);demand(from.entryId!==to.entryId||from.revision!==to.revision||from.hash!==to.hash,'INVALID_KNOWLEDGE_RELATIONSHIP','Relate two different retained versions.');
  const same=(a:KnowledgeReference,b:KnowledgeReference)=>a.entryId===b.entryId&&a.revision===b.revision&&a.hash===b.hash;
  const prior=effectiveKnowledgeRelationships(store.list<KnowledgeRelationship>('knowledge-relationship').filter(item=>item.projectId===projectId)).find(item=>item.kind===input.kind&&(same(item.from,from)&&same(item.to,to)||input.kind==='conflicts'&&same(item.from,to)&&same(item.to,from)));
  const note=input.note??prior?.note;demand(text(note,4000),'INVALID_KNOWLEDGE_RELATIONSHIP','Record the evidence for this owner decision.');
  demand(input.evidence===undefined||Array.isArray(input.evidence)&&input.evidence.length<=20,'INVALID_KNOWLEDGE_RELATIONSHIP','Keep the evidence list bounded.');const evidence=(input.evidence??prior?.evidence??[]).map(value=>knowledgeReference(store,projectId,value));
  const result:KnowledgeRelationship={id:randomUUID(),projectId,kind:input.kind,from,to,note,evidence,resolved:input.resolved===true,revision:(prior?.revision??0)+1,at:new Date().toISOString(),actor:actor.name,ownerConfirmed:true};
  store.transaction(()=>{store.put('knowledge-relationship',result);store.event({projectId,runId:null,stageId:null,type:'knowledge.relationship',actor:actor.name,message:input.resolved?'Owner resolved the retained knowledge relationship.':'Owner recorded an exact knowledge relationship.',data:{relationshipId:result.id,kind:result.kind,from,to,resolved:result.resolved}});});return result;
}
export function reviewKnowledgeLesson(store:Store,project:Project,entryId:string,input:LessonReviewInput,actor:Actor):KnowledgeEntry{
  demand(!actor.projectId,'OWNER_REQUIRED','Lesson review requires the project owner.',403);demand(isObject(input)&&['retain','decline'].includes(input.decision)&&Number.isSafeInteger(input.expectedRevision)&&Number.isSafeInteger(input.expectedLifecycleRevision),'INVALID_LESSON_REVIEW','Review the exact pending lesson version.');
  return store.transaction(()=>{
    const entry=store.get<KnowledgeEntry>('knowledge',entryId);demand(entry?.projectId===project.id&&entry.kind==='lesson','KNOWLEDGE_NOT_FOUND','Choose a lesson in this project.',404);
    demand(entry.status==='proposed'&&entry.proposal?.status==='pending','LESSON_REVIEW_REQUIRED','Only pending proposals can be reviewed.',409);demand(entry.revision===input.expectedRevision&&(entry.lifecycleRevision??0)===input.expectedLifecycleRevision,'REVISION_CONFLICT','This proposal changed. Refresh before reviewing it.',409);
    const title=input.title??entry.title,content=input.content??entry.content,roles=input.roles??entry.roles;demand(text(title,300)&&text(content,200000)&&Array.isArray(roles)&&roles.every(role=>project.roles.some(item=>item.id===role)),'INVALID_LESSON','Retain a useful title/content and valid role scope.');
    demand((input.evidence===undefined||Array.isArray(input.evidence)&&input.evidence.length<=20)&&(!input.note||text(input.note,4000)),'INVALID_LESSON_REVIEW','Keep review evidence and note bounded.');const evidence=(input.evidence??[]).map(value=>knowledgeReference(store,project.id,value));
    const next:KnowledgeEntry={...entry,title,content,roles,hash:content===entry.content?entry.hash:hashContent(content),revision:entry.revision+Number(title!==entry.title||content!==entry.content||JSON.stringify(roles)!==JSON.stringify(entry.roles)),lifecycleRevision:(entry.lifecycleRevision??0)+1,status:input.decision==='retain'?'current':'declined',proposal:{...entry.proposal,status:input.decision==='retain'?'retained':'declined',review:{at:new Date().toISOString(),actor:actor.name,decision:input.decision,note:input.note,evidence}}};
    store.put('knowledge',next);store.event({projectId:project.id,runId:entry.originRunId??null,stageId:null,type:input.decision==='retain'?'knowledge.lesson_retained':'knowledge.lesson_declined',actor:actor.name,message:'Owner reviewed the exact proposed lesson; earlier work remains unchanged.',data:{entryId,revision:next.revision,lifecycleRevision:next.lifecycleRevision,decision:input.decision}});return next;
  });
}
