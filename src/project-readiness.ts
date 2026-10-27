import {createHash} from 'node:crypto';
import path from 'node:path';
import type {KnowledgeEntry,KnowledgeSource,KnowledgeSyncResult,Pipeline,Project,ProjectReadiness} from './contracts.ts';
import {inspectWorkspace} from './workspaces.ts';
import type {Store} from './store.ts';

export type KnowledgeIndexReceipt={id:string;at:string;sources:Record<string,string>;stats:KnowledgeSyncResult['stats']};

export function sourceSignature(project:Project,source:KnowledgeSource):string{
  return createHash('sha256').update(JSON.stringify({path:path.resolve(project.workspace,source.path),kind:source.kind,section:source.section??null,roles:[...new Set(source.roles)].sort()})).digest('hex');
}

/** Unknown or recursive child references cannot prove that a workflow is human-only. */
export function pipelineNeedsModel(pipeline:Pipeline,pipelines:Pipeline[],seen=new Set<string>()):boolean{
  if(seen.has(pipeline.id))return true;
  const visited=new Set(seen).add(pipeline.id);
  return pipeline.stages.some(stage=>stage.executor==='codex'||stage.executor==='pipeline'&&(()=>{const child=pipelines.find(item=>item.id===stage.options?.pipelineId&&item.projectId===pipeline.projectId);return !child||pipelineNeedsModel(child,pipelines,visited);})());
}

export async function projectReadiness(project:Project,store:Store):Promise<ProjectReadiness>{
  const entries=store.list<KnowledgeEntry>('knowledge').filter(entry=>entry.projectId===project.id),configured=new Set(project.knowledgeSources.map(source=>source.id));
  const sourceEntries=entries.filter(entry=>entry.kind!=='lesson'&&configured.has(entry.sourceId)),receipt=store.get<KnowledgeIndexReceipt>('knowledge-index',project.id);
  const indexedSources=project.knowledgeSources.filter(source=>receipt?.sources[source.id]===sourceSignature(project,source)&&!sourceEntries.some(entry=>entry.sourceId===source.id&&entry.status!=='current')).length;
  const missingEntries=sourceEntries.filter(entry=>entry.status==='missing').length,errorEntries=sourceEntries.filter(entry=>entry.status==='error').length;
  return{projectId:project.id,projectRevision:project.revision,observedAt:new Date().toISOString(),workspace:await inspectWorkspace(project.workspace),knowledge:{status:!configured.size?'not_configured':missingEntries||errorEntries?'issues':indexedSources===configured.size?'indexed':'not_indexed',configuredSources:configured.size,indexedSources,currentEntries:entries.filter(entry=>entry.status==='current').length,missingEntries,errorEntries,...(receipt?{lastSyncedAt:receipt.at}:{})}};
}
