import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import type { KnowledgeEntry, KnowledgeSource, KnowledgeSyncResult, Project } from './contracts.ts';

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

function selectContent(content: string, source: KnowledgeSource, path: string): { content: string; title: string } {
  const headings = extname(path).toLowerCase() === '.md' ? markdownHeadings(content) : [];
  if (source.section !== undefined) {
    if (extname(path).toLowerCase() !== '.md') throw new SourceError('A section selector requires a Markdown file.');
    const matches = headings.filter(heading => heading.title === source.section);
    if (matches.length === 0) throw new SourceError('The selected Markdown section is missing.');
    if (matches.length > 1) throw new SourceError('The selected Markdown section is ambiguous.');
    const heading = matches[0];
    const end = headings.find(next => next.line > heading.line && next.level <= heading.level)?.line;
    return { content: content.split('\n').slice(heading.line, end).join('\n').trimEnd(), title: heading.title };
  }
  return { content: content.trimEnd(), title: headings[0]?.title || basename(path) };
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
export async function syncKnowledge(project: Project, previous: KnowledgeEntry[]): Promise<KnowledgeSyncResult> {
  const syncedAt = new Date().toISOString();
  const stats: KnowledgeSyncResult['stats'] = { added: 0, changed: 0, unchanged: 0, missing: 0, errors: 0 };
  const projectPrevious = previous.filter(entry => entry.projectId === project.id);
  const previousById = new Map(projectPrevious.map(entry => [entry.id, entry]));
  const result = new Map<string, KnowledgeEntry>();
  for (const entry of projectPrevious.filter(entry => entry.kind === 'lesson')) result.set(entry.id, { ...entry, roles: [...entry.roles] });
  const configuredSources = new Set(project.knowledgeSources.map(source => source.id));
  const homeRoot = await realpath(homedir()).catch(() => resolve(homedir()));

  for (const source of project.knowledgeSources) {
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
        syncedAt, status: error.missing ? 'missing' : 'error', error: error.message,
      };
      result.set(id, entry);
      seen.add(id);
      stats[error.missing ? 'missing' : 'errors']++;
    }

    async function indexFile(path: string, sourceRelativePath: string, root: string): Promise<void> {
      try {
        if (isCredentialPath(path)) throw new SourceError('Credential and runtime configuration files cannot be indexed.');
        const read = await readText(path, root, budget, sourceRelativePath === '.' && source.kind === 'artifact' && isWorkflowFile(path));
        const selected = selectContent(read.text, source, path);
        const id = entryId(project.id, source.id, sourceRelativePath);
        const prior = previousById.get(id);
        const hash = hashContent(selected.content);
        const entry: KnowledgeEntry = {
          id, projectId: project.id, sourceId: source.id, kind: source.kind, roles: [...roles],
          title: selected.title, content: selected.content, hash,
          revision: prior ? prior.revision + Number(prior.hash !== hash) : 1,
          sourcePath: read.sourcePath, sourceRevision: `sha256:${hash}`, syncedAt, status: 'current',
        };
        result.set(id, entry);
        seen.add(id);
        stats[!prior ? 'added' : prior.hash === hash ? 'unchanged' : 'changed']++;
      } catch (error) {
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
  return { entries, stats };
}

/** Search current project entries with deterministic, Unicode-aware substring matching. */
export function searchKnowledge(entries: KnowledgeEntry[], query: string, role?: string, kind?: string, status:'current'|'archived'='current'): KnowledgeEntry[] {
  const normalize = (text: string): string => text.normalize('NFKC').toLowerCase();
  const phrase = normalize(query).trim();
  const terms = phrase.split(/\s+/).filter(Boolean);
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (status==='archived'?entry.kind==='lesson'&&entry.status==='archived':entry.status==='current')
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
