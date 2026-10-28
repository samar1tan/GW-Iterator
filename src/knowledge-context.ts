import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {KnowledgeEntry,Project} from './contracts.ts';
import type {Store} from './store.ts';
import {AppError,demand} from './validation.ts';
import {effectiveKnowledgeRelationships} from './knowledge.ts';
import type {KnowledgeContextIntent,KnowledgeContextPlan,KnowledgeContextRecord,KnowledgeContextScope,KnowledgeCorpusManifest,KnowledgeLocator,KnowledgeReadAccess,KnowledgeReadPage,KnowledgeRelationship,KnowledgeSearchInput,KnowledgeSearchPage,KnowledgeSelection,KnowledgeSelectionReason} from './knowledge-context-types.ts';
export type * from './knowledge-context-types.ts';

export const CONTEXT_LIMIT=32000;
const PASSAGE_LIMIT=2000,READ_LIMIT=4000,SEARCH_LIMIT=7000,EVIDENCE_LIMIT=8,STRATEGY='local-passages-v5',TOKENIZER='nfkc-icu-cjk-bigrams-v3',INDEX='fts5-corpus-v3';
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const stop=new Set(['the','a','an','and','or','to','of','in','for','is','are','be','was','were','with','this','that','these','those','please','project','task','work','fix','implement','review','how','what','why','when','where','do','does','did','can','could','would','should','must','may','about','after','before','from','by','as','on','at','it','its','we','our','you','your','use','using','open','read','show','find','search','source','sources','document','documents','context','information','evidence','的','了','和','与','在','请','项目','任务','打开','阅读','查看','查找','检索']);
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase();
const pathMentions=(text:string)=>(text.match(/(?:[~./\\]?[\p{L}\p{N}_.@+-]+[\/\\])+[\p{L}\p{N}_.@+-]+|[\p{L}\p{N}_@+-]+[.](?:md|txt|rst|tsx?|jsx?|json|ya?ml|css|html|go|py|rs|sh|sql)\b/giu)??[]).map(value=>value.replace(/[.]+$/g,''));
const withoutPathMentions=(text:string)=>pathMentions(text).reduce((value,path)=>value.replaceAll(path,' '),text);
const intentText=(value:unknown):string=>typeof value==='string'?value:Array.isArray(value)?value.map(intentText).join('\n'):value&&typeof value==='object'?Object.values(value).map(intentText).join('\n'):'';
export function boundedKnowledgeToolReply<T>(reply:T):T{demand(JSON.stringify(reply).length<=SEARCH_LIMIT,'KNOWLEDGE_CONTEXT_OVERFLOW','This context summary exceeds the bounded tool reply. Use a focused frozen knowledge search or located read.',409);return reply;}
export function knowledgeContextSummary(plan:KnowledgeContextPlan){
  const counts=new Map<string,number>();for(const gap of plan.gaps)counts.set(gap.code,(counts.get(gap.code)??0)+1);
  const result={id:plan.id,status:plan.status,manifest:{id:plan.manifest.id,contentHash:plan.manifest.contentHash,origin:plan.manifest.origin,governanceBoundary:plan.manifest.governanceBoundary,captureStartedAt:plan.manifest.captureStartedAt,captureCompletedAt:plan.manifest.captureCompletedAt,documentCount:plan.manifest.documents.length,unavailableCount:plan.manifest.issues.length},budget:plan.budget,gaps:[...counts].map(([code,count])=>({code,count})),selected:[] as KnowledgeLocator[],omittedLocators:plan.guidance.length+plan.evidence.length};
  for(const item of [...plan.guidance,...plan.evidence]){result.selected.push(item.locator);result.omittedLocators--;if(JSON.stringify(result).length>SEARCH_LIMIT-1000){result.selected.pop();result.omittedLocators++;}}
  return boundedKnowledgeToolReply(result);
}
export function knowledgeTerms(text:string):string[]{
  const value=normalize(text.replace(/([a-z\d])([A-Z])/g,'$1 $2')),terms:string[]=[];
  for(const token of segmenter.segment(value))if(token.isWordLike&&!stop.has(token.segment))terms.push(token.segment);
  for(const run of value.match(/[\p{Script=Han}]{2,}/gu)??[]){const chars=[...run];for(let i=0;i<chars.length-1;i++)terms.push(chars[i]+chars[i+1]);}
  for(const token of value.split(/[^\p{L}\p{N}]+/u))if(token.length>1&&!stop.has(token))terms.push(token);
  return [...new Set(terms)].filter(token=>token.length<=160);
}
type Node={type:string;depth?:number;value?:string;children?:Node[];position?:{start:{offset:number};end:{offset:number}}};
type Passage={entry:KnowledgeEntry;chunkId:string;content:string;body:string;bodyTerms:Set<string>;headingPath:string[];startLine:number;endLine:number;startOffset:number;endOffset:number;ordinal:number};
type RankedPassage={passage:Passage;reasons:KnowledgeSelectionReason[];score:number};
type RankedResult={items:RankedPassage[];omissions:KnowledgeContextPlan['omissions'];discovery:boolean};
export type FrozenKnowledgeCorpus={id:string;manifest:KnowledgeCorpusManifest;entries:KnowledgeEntry[];relationships:KnowledgeRelationship[]};
type CorpusIndex={db:DatabaseSync;passages:Passage[];bytes:number};
const applicable=(entry:{roles:string[]},roleId:string)=>!entry.roles.length||entry.roles.includes(roleId);
const textOf=(node:Node):string=>node.value??node.children?.map(textOf).join('')??'';
function passages(entry:KnowledgeEntry):Passage[]{
  const content=entry.content,tree=unified().use(remarkParse).use(remarkGfm).parse(content) as unknown as Node;
  const headingRanges=(tree.children??[]).filter(node=>node.type==='heading'&&node.position).map(node=>[node.position!.start.offset,node.position!.end.offset]);
  const starts=[0];for(let i=0;i<content.length;i++)if(content[i]==='\n')starts.push(i+1);
  const line=(offset:number)=>{let a=0,b=starts.length;while(a+1<b){const m=(a+b)>>1;if(starts[m]<=offset)a=m;else b=m;}return(entry.sourceLineStart??1)+a;};
  const headings:{depth:number;title:string}[]=[],result:Passage[]=[];
  const emit=(start:number,end:number)=>{
    while(start<end){let finish=Math.min(end,start+PASSAGE_LIMIT);if(finish<end){const newline=content.lastIndexOf('\n',finish);if(newline>start+PASSAGE_LIMIT/2)finish=newline+1;else if(/[\uD800-\uDBFF]/.test(content[finish-1]??''))finish--;}
      const text=content.slice(start,finish);let cursor=start,body='';for(const [a,b] of headingRanges)if(a<finish&&b>start){body+=content.slice(cursor,Math.max(cursor,a));cursor=Math.max(cursor,b);}body+=content.slice(Math.min(cursor,finish),finish);
      if(text.trim())result.push({entry,chunkId:hash([entry.id,entry.hash,start,finish]).slice(0,28),content:text,body,bodyTerms:new Set(knowledgeTerms(body)),headingPath:headings.map(item=>item.title),startLine:line(start),endLine:line(Math.max(start,finish-1)),startOffset:start,endOffset:finish,ordinal:result.length});start=finish;}
  };
  for(const node of tree.children??[]){if(!node.position)continue;const start=node.position.start.offset,finish=node.position.end.offset;
    if(node.type==='heading'){while(headings.length&&headings.at(-1)!.depth>=(node.depth??1))headings.pop();headings.push({depth:node.depth??1,title:textOf(node)});emit(start,finish);continue;}
    if(node.type==='paragraph')emit(start,finish);
    else if(node.type==='list'){for(const child of node.children??[])if(child.position)emit(child.position.start.offset,child.position.end.offset);}
    else emit(start,finish);
  }
  return result;
}
export class KnowledgeContextService {
  private indexes=new Map<string,CorpusIndex>();private store:Store;private now:()=>number;
  private sections=new WeakMap<KnowledgeEntry,{start:number;end:number}[]>();
  constructor(store:Store,options:{now?:()=>number}={}){this.store=store;this.now=options.now??Date.now;}
  freeze(input:{project:Project;entries:KnowledgeEntry[];origin:KnowledgeCorpusManifest['origin'];captureStartedAt?:string;captureCompletedAt?:string;capturedRelationships?:KnowledgeRelationship[]}):FrozenKnowledgeCorpus{
    const entries=input.entries.filter(entry=>entry.projectId===input.project.id&&entry.status==='current').map(entry=>structuredClone(entry));
    const documents=entries.map(entry=>({entryId:entry.id,revision:entry.revision,hash:entry.hash,sourceId:entry.sourceId,sourcePath:entry.sourcePath,sourceRevision:entry.sourceRevision,title:entry.title,kind:entry.kind,roles:entry.roles,purpose:entry.purpose??'reference',purposeOrigin:entry.purposeOrigin??'reference-default',sourceLineStart:entry.sourceLineStart??1,characters:entry.content.length}));
    const relationships=structuredClone(input.capturedRelationships??(input.origin==='legacy-frozen'?[]:effectiveKnowledgeRelationships(this.store.list<KnowledgeRelationship>('knowledge-relationship').filter(item=>item.projectId===input.project.id&&item.ownerConfirmed))));
    const issues=input.entries.filter(entry=>entry.projectId===input.project.id&&entry.kind!=='lesson'&&['missing','error'].includes(entry.status)).map(entry=>({code:entry.status==='missing'?'SOURCE_MISSING' as const:'SOURCE_ERROR' as const,sourceId:entry.sourceId,entryId:entry.id,purpose:entry.purpose??'reference' as const,roles:entry.roles,message:entry.error??'The registered source is unavailable.'}));
    const contentHash=hash([input.project.id,documents,entries.map(entry=>hash(entry.content)),issues,relationships]),id=input.origin==='legacy-frozen'?'legacy-'+contentHash:'corpus-'+randomUUID(),at=new Date(this.now()).toISOString();
    const corpus:FrozenKnowledgeCorpus={id,entries,relationships,manifest:{id,projectId:input.project.id,projectRevision:input.project.revision,contentHash,origin:input.origin,governanceBoundary:input.origin==='legacy-frozen'?'legacy-unknown':'captured',captureStartedAt:input.captureStartedAt??at,captureCompletedAt:input.captureCompletedAt??at,documents,issues}};
    const prior=this.store.get<FrozenKnowledgeCorpus>('knowledge-corpus',id);if(prior)return prior;this.store.put('knowledge-corpus',corpus);return corpus;
  }
  corpus(id:string,projectId:string):FrozenKnowledgeCorpus{const value=this.store.get<FrozenKnowledgeCorpus>('knowledge-corpus',id);demand(value&&value.manifest.projectId===projectId,'KNOWLEDGE_SCOPE','Choose a frozen corpus in this project.',403);return value;}
  private index(corpus:FrozenKnowledgeCorpus,signal?:AbortSignal):CorpusIndex{
    signal?.throwIfAborted();const key=hash([corpus.manifest.contentHash,INDEX,TOKENIZER]),known=this.indexes.get(key);if(known){this.indexes.delete(key);this.indexes.set(key,known);return known;}
    const db=new DatabaseSync(':memory:');let list:Passage[]=[];
    try{db.exec('CREATE VIRTUAL TABLE passages USING fts5(title,path,heading,body)');const insert=db.prepare('INSERT INTO passages(rowid,title,path,heading,body) VALUES(?,?,?,?,?)');
      for(const entry of corpus.entries){signal?.throwIfAborted();for(const item of passages(entry)){list.push(item);insert.run(list.length,knowledgeTerms(entry.title).join(' '),knowledgeTerms(entry.sourcePath??'').join(' '),knowledgeTerms(item.headingPath.join(' ')).join(' '),[...item.bodyTerms].join(' '));}}
    }catch(error){db.close();throw error;}
    const value={db,passages:list,bytes:corpus.entries.reduce((n,e)=>n+e.content.length*2,0)};this.indexes.set(key,value);
    while(this.indexes.size>4||[...this.indexes.values()].reduce((n,i)=>n+i.bytes,0)>64*1024*1024&&this.indexes.size>1){const first=this.indexes.entries().next().value!;first[1].db.close();this.indexes.delete(first[0]);}return value;
  }
  private selection(corpusId:string,item:Passage,reasons:KnowledgeSelectionReason[]):KnowledgeSelection{return{id:item.entry.id,title:item.entry.title,revision:item.entry.revision,hash:item.entry.hash,content:item.content,locator:{corpusId,entryId:item.entry.id,revision:item.entry.revision,hash:item.entry.hash,chunkId:item.chunkId,headingPath:item.headingPath,startLine:item.startLine,endLine:item.endLine,startOffset:item.startOffset,endOffset:item.endOffset},aliases:[],reasons};}
  private materialize(corpusId:string,index:CorpusIndex,item:Passage,reasons:KnowledgeSelectionReason[],bodyMatch:boolean):KnowledgeSelection{
    if(!bodyMatch)return this.selection(corpusId,item,reasons);
    let sections=this.sections.get(item.entry);
    if(!sections){const tree=unified().use(remarkParse).use(remarkGfm).parse(item.entry.content) as unknown as Node,heads=(tree.children??[]).filter(node=>node.type==='heading'&&node.position),stack:{depth:number;index:number}[]=[];sections=[];for(const head of heads){const start=head.position!.start.offset,depth=head.depth??1;while(stack.length&&stack.at(-1)!.depth>=depth)sections[stack.pop()!.index].end=start;const index=sections.length;sections.push({start,end:item.entry.content.length});stack.push({depth,index});}this.sections.set(item.entry,sections);}
    const section=sections.findLast(value=>value.start<=item.startOffset&&item.endOffset<=value.end);if(!section)return this.selection(corpusId,item,reasons);
    const parts=index.passages.filter(part=>part.entry.id===item.entry.id&&part.entry.hash===item.entry.hash&&part.startOffset>=section.start&&part.endOffset<=section.end),first=parts[0],last=parts.at(-1);
    if(!first||!last||last.endOffset-first.startOffset>PASSAGE_LIMIT||first.startOffset===item.startOffset&&last.endOffset===item.endOffset)return this.selection(corpusId,item,reasons);
    const start=first.startOffset,end=last.endOffset,span={...item,content:item.entry.content.slice(start,end),chunkId:hash([item.entry.id,item.entry.hash,start,end]).slice(0,28),headingPath:first.headingPath,startLine:first.startLine,endLine:last.endLine,startOffset:start,endOffset:end};
    return this.selection(corpusId,span,[...reasons,'SECTION_CONTEXT']);
  }
  private ranked(scope:KnowledgeContextScope,query:string,signal?:AbortSignal,accept:(entry:KnowledgeEntry)=>boolean=()=>true,facets:string[]=[query]):RankedResult{
    const corpus=this.corpus(scope.corpusId,scope.projectId),index=this.index(corpus,signal),terms:string[]=[],queues=facets.map(knowledgeTerms);for(let position=0;terms.length<128&&queues.some(items=>position<items.length);position++)for(const items of queues){const term=items[position];if(term&&!terms.includes(term)&&terms.length<128)terms.push(term);}
    if(!terms.length)return{items:[],omissions:[],discovery:false};const match=terms.map(term=>'"'+term.replaceAll('"','""')+'"').join(' OR '),termSet=new Set(terms);
    const rows=index.db.prepare('SELECT rowid,bm25(passages,6,10,5,1) AS rank FROM passages WHERE passages MATCH ? ORDER BY rank,rowid').all(match) as {rowid:number;rank:number}[];
    const q=normalize(query),identifiers=(query.match(/[A-Za-z_][A-Za-z0-9_./:-]{2,}/g)??[]).map(value=>value.replace(/[.:/-]+$/g,'')),paths=pathMentions(query),bodyQueryTerms=new Set(knowledgeTerms(withoutPathMentions(query))),pathNavigation=paths.length>0&&knowledgeTerms(withoutPathMentions(facets[0]??query)).length===0;
    const candidates=rows.map(row=>{const passage=index.passages[Number(row.rowid)-1],reasons:KnowledgeSelectionReason[]=[];let score=-Number(row.rank);
      const path=passage.entry.sourcePath;if(path&&(q.includes(normalize(path))||[...identifiers,...paths].some(term=>normalize(path).endsWith(normalize(term))))){score+=20;reasons.push('EXACT_PATH');}
      if(identifiers.some(term=>/[_.:/]/.test(term)&&normalize(passage.body).includes(normalize(term)))){score+=10;reasons.push('EXACT_SYMBOL');}
      return{passage,reasons,score};}).filter(item=>accept(item.passage.entry)).sort((a,b)=>b.score-a.score||a.passage.entry.id.localeCompare(b.passage.entry.id)||a.passage.ordinal-b.passage.ordinal);
    const compounds=identifiers.filter(value=>/[_.:]|[a-z][A-Z]/.test(value)),groups=compounds.filter(value=>!/[\/\\]/.test(value)&&!paths.includes(value)).map(value=>knowledgeTerms(value.replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/[_.:/-]/g,' ')));
    const bodyDocuments=new Map<string,Set<string>>();for(const item of index.passages)if(accept(item.entry)){let set=bodyDocuments.get(item.entry.id);if(!set){set=new Set();bodyDocuments.set(item.entry.id,set);}for(const term of item.bodyTerms)if(termSet.has(term))set.add(term);}
    const weights=new Map(terms.map(term=>{const df=[...bodyDocuments.values()].filter(tokens=>tokens.has(term)).length;return[term,Math.log(1+(bodyDocuments.size-df+0.5)/(df+0.5))];}));
    const bodyCandidates=candidates.map(item=>{const tokens=item.passage.bodyTerms,anchors=groups.filter(group=>group.length&&group.every(term=>tokens.has(term))).length,matched=terms.filter(term=>bodyQueryTerms.has(term)&&tokens.has(term)),support=matched.reduce((sum,term)=>sum+(weights.get(term)??0),0)/Math.sqrt(Math.max(1,tokens.size/40))+anchors*10;return{...item,score:support,anchors,matched};}).filter(item=>!pathNavigation&&item.matched.length);
    const hasAnchors=bodyCandidates.some(item=>item.anchors>0),maximum=Math.max(0,...bodyCandidates.map(item=>item.score));
    // A topic fragment is not a substitute for a requested identifier. Keep strong lexical
    // support and independent identifier facets; do not consume the envelope merely because it fits.
    const supported=bodyCandidates.filter(item=>(!groups.length||hasAnchors)&&(item.anchors>0||item.score>=maximum*0.3)).sort((a,b)=>b.score-a.score||a.passage.entry.id.localeCompare(b.passage.entry.id)||a.passage.ordinal-b.passage.ordinal),selected=new Set(supported.map(item=>item.passage.chunkId));
    let items:RankedPassage[]=supported,discovery=false;
    if(!items.length){
      // Metadata discovers a document or section; it is not evidence for every descendant paragraph.
      const contains=(text:string)=>{const meaningful=knowledgeTerms(text);return meaningful.length>0&&q.includes(normalize(text).trim());};
      const anchor=candidates.find(item=>item.reasons.includes('EXACT_PATH')||contains(item.passage.entry.title)||item.passage.headingPath.some(contains));
      if(anchor){const section=!pathNavigation&&anchor.passage.headingPath.some(contains),first=index.passages.find(item=>item.entry.id===anchor.passage.entry.id&&item.body.trim()&&(!section||JSON.stringify(item.headingPath)===JSON.stringify(anchor.passage.headingPath)))??anchor.passage;items=[{...anchor,passage:first,reasons:[...anchor.reasons,'DOCUMENT_DISCOVERY']}];selected.add(first.chunkId);discovery=true;}
    }
    const omissions:KnowledgeContextPlan['omissions']=[];for(const item of candidates)if(!selected.has(item.passage.chunkId)){const reason=item.passage.bodyTerms.size&&[...item.passage.bodyTerms].some(term=>termSet.has(term))?'WEAK_BODY_MATCH':'METADATA_ONLY',prior=omissions.find(value=>value.entryId===item.passage.entry.id&&value.reason===reason);if(prior){prior.passages++;prior.characters+=item.passage.content.length;}else omissions.push({reason,entryId:item.passage.entry.id,passages:1,characters:item.passage.content.length});}
    return{items,omissions,discovery};
  }
  private taskEvidence(base:FrozenKnowledgeCorpus,scope:KnowledgeContextScope,intent:KnowledgeContextIntent):{corpus:FrozenKnowledgeCorpus;entries:{key:'upstream'|'feedback';index:number;entry:KnowledgeEntry}[]} {
    const entries:{key:'upstream'|'feedback';index:number;entry:KnowledgeEntry}[]=[];
    for(const [key,values] of [['upstream',intent.upstream??[]],['feedback',intent.feedback??[]]] as const)for(const [index,value] of values.entries()){
      const content=JSON.stringify(value,null,2);if(!content||content.length>1024*1024)continue;
      const entry:KnowledgeEntry={id:'task-evidence-'+hash([scope.runId,scope.stageId,scope.attemptId,key,index,content]).slice(0,28),projectId:scope.projectId,sourceId:'task-evidence',kind:'artifact',roles:[],title:(key==='upstream'?'Recorded upstream result ':'Previous attempt/rework feedback ')+(index+1),content,hash:hash(content),revision:1,status:'current',syncedAt:base.manifest.captureCompletedAt,purpose:'reference',purposeOrigin:'reference-default',sourceLineStart:1};entries.push({key,index,entry});
    }
    if(!entries.length)return{corpus:base,entries};
    const id='evidence-'+hash([base.id,entries.map(item=>[item.entry.id,item.entry.hash])]),known=this.store.get<FrozenKnowledgeCorpus>('knowledge-corpus',id);if(known)return{corpus:known,entries};
    const documents=entries.map(({entry})=>({entryId:entry.id,revision:entry.revision,hash:entry.hash,sourceId:entry.sourceId,title:entry.title,kind:entry.kind,roles:entry.roles,purpose:'reference' as const,purposeOrigin:'reference-default' as const,sourceLineStart:1,characters:entry.content.length}));
    const corpus:FrozenKnowledgeCorpus={...base,id,entries:[...base.entries,...entries.map(item=>item.entry)],manifest:{...base.manifest,id,baseCorpusId:base.id,contentHash:hash([base.manifest.contentHash,documents]),documents:[...base.manifest.documents,...documents]}};this.store.put('knowledge-corpus',corpus);return{corpus,entries};
  }
  select(scope:KnowledgeContextScope,intent:KnowledgeContextIntent,options:{signal?:AbortSignal;limitChars?:number}={}):KnowledgeContextPlan{
    const taskEvidence=this.taskEvidence(this.corpus(scope.corpusId,scope.projectId),scope,intent),corpus=taskEvidence.corpus;scope={...scope,corpusId:corpus.id};const limit=options.limitChars??CONTEXT_LIMIT,at=new Date(this.now()).toISOString(),guidance:KnowledgeSelection[]=[],evidence:KnowledgeSelection[]=[],gaps:KnowledgeContextPlan['gaps']=[],omissions:KnowledgeContextPlan['omissions']=[];
    const queryFacets={task:[intent.request,intent.reply??'',intentText(intent.history)].join('\n'),stage:intent.phase==='coordinate'?'':intentText(intent.stage),upstream:intentText([intent.upstream??[],intent.feedback??[]])};
    const index=this.index(corpus,options.signal),superseded=new Set(corpus.relationships.filter(relation=>relation.kind==='supersedes'&&!relation.resolved&&corpus.entries.some(entry=>entry.id===relation.from.entryId&&entry.revision===relation.from.revision&&entry.hash===relation.from.hash&&applicable(entry,scope.roleId))).map(relation=>JSON.stringify([relation.to.entryId,relation.to.revision,relation.to.hash]))),eligible=corpus.entries.filter(entry=>applicable(entry,scope.roleId)&&!superseded.has(JSON.stringify([entry.id,entry.revision,entry.hash]))),eligibleIds=new Set(eligible.map(entry=>entry.id));
    for(const entry of eligible.filter(entry=>entry.purpose==='guidance')){const chunks=index.passages.filter(item=>item.entry.id===entry.id);for(const chunk of chunks)guidance.push(this.selection(scope.corpusId,chunk,['REQUIRED_GUIDANCE']));}
    for(const issue of corpus.manifest.issues)if(applicable(issue,scope.roleId))gaps.push({code:issue.purpose==='guidance'?'GUIDANCE_MISSING':'REFERENCE_UNAVAILABLE',entryIds:[issue.entryId],message:issue.message});
    const exact=(ref:{entryId:string;revision:number;hash:string})=>eligible.find(entry=>entry.id===ref.entryId&&entry.revision===ref.revision&&entry.hash===ref.hash);
    for(const relation of corpus.relationships)if(relation.kind==='conflicts'&&!relation.resolved){const from=exact(relation.from),to=exact(relation.to);if(from&&to&&(from.purpose==='guidance'||to.purpose==='guidance'))gaps.push({code:'GUIDANCE_CONFLICT',entryIds:[from.id,to.id],message:relation.note});}
    const payload={request:intent.request,...intent.execution,baseline:intent.baseline,conversation:intent.history,...(intent.reply?{reply:intent.reply}:{}),stage:intent.stage,guidance,evidence,coverage:{unavailableReferences:corpus.manifest.issues.filter(item=>item.purpose==='reference').length,discoveryOnly:false,lookup:'Use scoped knowledge search, including a refined/translated query, and exact located reads when more evidence is needed. A discovery-only anchor matches metadata, not evidence that its body answers the request.'},upstream:[] as unknown[],feedback:[] as unknown[]};
    const serialize=()=>JSON.stringify({...payload,guidance:guidance.map(({aliases,reasons,...item})=>item),evidence:evidence.map(({aliases,reasons,...item})=>({...item,...(reasons.includes('SECTION_CONTEXT')?{structuralContext:true}:{})}))});if(serialize().length>limit)gaps.push({code:'GUIDANCE_OVERFLOW',entryIds:guidance.map(item=>item.id),message:'Required guidance and the task exceed the context envelope. Select a smaller required section; no model was dispatched.'});
    for(const [key,values] of [['upstream',intent.upstream??[]],['feedback',intent.feedback??[]]] as const)for(const [number,item] of values.entries()){
      payload[key].push(item);if(serialize().length<=limit)continue;payload[key].pop();
      const attachment=taskEvidence.entries.find(candidate=>candidate.key===key&&candidate.index===number),passage=attachment?index.passages.find(candidate=>candidate.entry.id===attachment.entry.id):undefined,locator=passage?this.selection(scope.corpusId,passage,[]).locator:undefined;
      const pointer={omittedCompleteItem:true,kind:key,index:number+1,...(locator?{read:locator}:{})};payload[key].push(pointer);if(serialize().length>limit)payload[key].pop();
      gaps.push({code:'BUDGET_OMISSION',entryIds:attachment?[attachment.entry.id]:[],message:locator?'A complete dependency/feedback item exceeds the shared envelope; its exact frozen content is available through this located read.':'A dependency/feedback item exceeds the bounded evidence preparation; inspect the original recorded execution.',...(locator?{locator}:{})});
    }
    const fingerprints=new Map<string,KnowledgeSelection>(),considered=new Map<string,KnowledgeSelection>();for(const item of guidance)fingerprints.set(hash(item.content),item);
    const query=[queryFacets.task,queryFacets.stage,queryFacets.upstream].join('\n'),ranked=this.ranked(scope,query,options.signal,entry=>entry.purpose!=='guidance'&&eligibleIds.has(entry.id)&&entry.sourceId!=='task-evidence',Object.values(queryFacets));omissions.push(...ranked.omissions);payload.coverage.discoveryOnly=ranked.discovery;
    const omit=(reason:'DUPLICATE_TEXT'|'BUDGET'|'LOWER_RANK',item:KnowledgeSelection)=>{const prior=omissions.find(value=>value.entryId===item.id&&value.reason===reason);if(prior){prior.passages++;prior.characters+=item.content.length;}else omissions.push({reason,entryId:item.id,passages:1,characters:item.content.length});};
    for(const candidate of ranked.items){
      const haystack=candidate.passage.bodyTerms,reasons=[...candidate.reasons];if(!ranked.discovery){if(knowledgeTerms(withoutPathMentions(queryFacets.task)).some(term=>haystack.has(term)))reasons.push('TASK_TEXT');if(knowledgeTerms(withoutPathMentions((intent.stage?.checks??[]).join(' '))).some(term=>haystack.has(term)))reasons.push('STAGE_CHECK');else if(knowledgeTerms(withoutPathMentions(queryFacets.stage)).some(term=>haystack.has(term)))reasons.push('STAGE_CONTEXT');if(knowledgeTerms(withoutPathMentions(queryFacets.upstream)).some(term=>haystack.has(term)))reasons.push('UPSTREAM_FINDING');}const item=this.materialize(scope.corpusId,index,candidate.passage,[...new Set(reasons)],!ranked.discovery),rangeKey=JSON.stringify([item.id,item.locator.chunkId]),prior=considered.get(rangeKey);if(prior){prior.reasons=[...new Set([...prior.reasons,...item.reasons])];continue;}considered.set(rangeKey,item);const fingerprint=hash(item.content),duplicate=fingerprints.get(fingerprint);
      if(duplicate){if(duplicate.id===item.id&&duplicate.locator.chunkId===item.locator.chunkId){duplicate.reasons=[...new Set([...duplicate.reasons,...item.reasons])];continue;}duplicate.aliases.push({entryId:item.id,revision:item.revision,hash:item.hash,corpusId:scope.corpusId});omit('DUPLICATE_TEXT',item);continue;}
      if(evidence.length>=EVIDENCE_LIMIT){omit('LOWER_RANK',item);continue;}
      evidence.push(item);if(serialize().length>limit){evidence.pop();omit('BUDGET',item);if(!gaps.some(gap=>gap.code==='BUDGET_OMISSION'))gaps.push({code:'BUDGET_OMISSION',entryIds:[item.id],message:'Some ranked evidence could not fit the serialized context envelope.'});continue;}fingerprints.set(fingerprint,item);
    }
    if(ranked.discovery&&evidence.length)gaps.push({code:'DISCOVERY_ONLY',entryIds:evidence.map(item=>item.id),message:'Only document or section metadata matched. This anchor is for inspection, not evidence that its body answers the task.',locator:evidence[0].locator});
    if(!evidence.length&&!guidance.length)gaps.push({code:'NO_RELEVANT_EVIDENCE',entryIds:[],message:'No relevant project passage matched. Refine or translate a query during the ordinary task; no unrelated source was substituted.'});
    const plan:KnowledgeContextPlan={id:'context-'+randomUUID(),scope:structuredClone(scope),manifest:corpus.manifest,strategyVersion:STRATEGY,tokenizerVersion:TOKENIZER+'-icu'+process.versions.icu,indexVersion:INDEX,intentHash:hash(intent),status:gaps.some(gap=>gap.code.startsWith('GUIDANCE_'))?'blocked':'ready',queryFacets,guidance,evidence,gaps,budget:{limitChars:limit,usedChars:serialize().length},omissions,context:serialize(),createdAt:at};
    this.store.put('knowledge-context',{id:plan.id,plan,reads:[]} satisfies KnowledgeContextRecord&{id:string});return plan;
  }
  access(scope:KnowledgeContextScope,selectionId:string):KnowledgeReadAccess{return{search:input=>this.search(scope,input,selectionId),read:locator=>this.read(scope,locator,selectionId)};}
  private receipt(scope:KnowledgeContextScope,selectionId:string|undefined,kind:'search'|'read',items:KnowledgeSelection[],query?:string){if(!selectionId)return;const record=this.store.get<KnowledgeContextRecord&{id:string}>('knowledge-context',selectionId);demand(record&&record.plan.scope.projectId===scope.projectId&&record.plan.scope.corpusId===scope.corpusId&&record.plan.scope.attemptId===scope.attemptId,'KNOWLEDGE_SCOPE','This selection belongs to another execution.',403);record.reads.push({id:randomUUID(),at:new Date(this.now()).toISOString(),kind,...(query?{query}:{}),locators:items.map(item=>item.locator)});this.store.put('knowledge-context',record);}
  async search(scope:KnowledgeContextScope,input:KnowledgeSearchInput,selectionId?:string):Promise<KnowledgeSearchPage>{
    demand(typeof input.query==='string'&&input.query.length<=8000,'INVALID_KNOWLEDGE_QUERY','Provide a bounded search query.');const query=input.query,result=this.ranked(scope,query,undefined,entry=>((input.role==='all'||input.role==='')||applicable(entry,input.role??scope.roleId))&&(!input.kind||entry.kind===input.kind)),index=this.index(this.corpus(scope.corpusId,scope.projectId)),ranked:KnowledgeSelection[]=[],seen=new Set<string>();for(const candidate of result.items){const item=this.materialize(scope.corpusId,index,candidate.passage,[...candidate.reasons,...(result.discovery?[]:['TASK_TEXT' as const])],!result.discovery),key=JSON.stringify([item.id,item.locator.chunkId]);if(!seen.has(key)){ranked.push(item);seen.add(key);}}let offset=0;
    if(input.cursor){let cursor;try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());}catch{throw new AppError('INVALID_KNOWLEDGE_CURSOR','Refresh this frozen search.');}demand(cursor.corpusId===scope.corpusId&&cursor.queryHash===hash([query,input.role,input.kind])&&Number.isSafeInteger(cursor.offset)&&cursor.offset>=0,'KNOWLEDGE_SCOPE','The search cursor belongs to another query or corpus.',403);offset=cursor.offset;}
    const matches:KnowledgeSelection[]=[],page=(next:number):KnowledgeSearchPage=>({corpusId:scope.corpusId,matches,total:ranked.length,coverage:matches.length?(result.discovery?'discovery':'matched'):'no-match',...(next<ranked.length?{nextCursor:Buffer.from(JSON.stringify({corpusId:scope.corpusId,queryHash:hash([query,input.role,input.kind]),offset:next})).toString('base64url')}:{})});let position=offset;
    for(;position<ranked.length&&matches.length<6;position++){matches.push(ranked[position]);if(JSON.stringify(page(position+1)).length>SEARCH_LIMIT){matches.pop();demand(matches.length,'KNOWLEDGE_METADATA_OVERFLOW','This passage metadata exceeds the bounded tool reply. Inspect its frozen source manifest.',409);break;}}
    const reply=page(position);demand(JSON.stringify(reply).length<=SEARCH_LIMIT,'KNOWLEDGE_METADATA_OVERFLOW','This passage metadata exceeds the bounded tool reply. Inspect its frozen source manifest.',409);this.receipt(scope,selectionId,'search',matches,query);return reply;
  }
  async read(scope:KnowledgeContextScope,locator:KnowledgeLocator,selectionId?:string):Promise<KnowledgeReadPage>{
    demand(locator&&locator.corpusId===scope.corpusId,'KNOWLEDGE_SCOPE','Read only this execution\'s frozen corpus.',403);const corpus=this.corpus(scope.corpusId,scope.projectId),index=this.index(corpus),parts=index.passages.filter(item=>item.entry.id===locator.entryId&&item.entry.revision===locator.revision&&item.entry.hash===locator.hash);
    const located=parts.find(item=>item.chunkId===locator.chunkId&&item.startLine===locator.startLine&&item.endLine===locator.endLine&&(locator.startOffset===undefined||locator.startOffset===item.startOffset)&&(locator.endOffset===undefined||locator.endOffset===item.endOffset));
    const first=located??parts.find(item=>Number.isSafeInteger(locator.startOffset)&&item.startOffset===locator.startOffset&&item.startLine===locator.startLine),last=located??parts.find(item=>Number.isSafeInteger(locator.endOffset)&&item.endOffset===locator.endOffset&&item.endLine===locator.endLine);
    demand(first&&last&&last.ordinal>=first.ordinal&&last.endOffset-first.startOffset<=READ_LIMIT&&locator.chunkId===hash([first.entry.id,first.entry.hash,first.startOffset,last.endOffset]).slice(0,28),'KNOWLEDGE_LOCATION_CHANGED','The frozen passage identity or range does not match.',409);
    const make=(end:Passage):KnowledgeReadPage=>{const content=first.entry.content.slice(first.startOffset,end.endOffset),span={...first,content,endOffset:end.endOffset,endLine:end.endLine,chunkId:hash([first.entry.id,first.entry.hash,first.startOffset,end.endOffset]).slice(0,28)},passage=this.selection(scope.corpusId,span,[]),next=parts.find(item=>item.ordinal===end.ordinal+1);return{corpusId:scope.corpusId,passage,complete:!next,...(next?{next:this.selection(scope.corpusId,next,[]).locator}:{})};};
    let reply=make(last);demand(JSON.stringify(reply).length<=SEARCH_LIMIT,'KNOWLEDGE_METADATA_OVERFLOW','This passage metadata exceeds the bounded tool reply. Inspect its frozen source manifest.',409);
    for(const end of parts)if(end.ordinal>last.ordinal&&end.endOffset-first.startOffset<=READ_LIMIT){const candidate=make(end);if(JSON.stringify(candidate).length>SEARCH_LIMIT)break;reply=candidate;}
    this.receipt(scope,selectionId,'read',[reply.passage]);return reply;
  }
  record(id:string):KnowledgeContextRecord|null{return this.store.get<KnowledgeContextRecord>('knowledge-context',id);}
  close(){for(const index of this.indexes.values())index.db.close();this.indexes.clear();}
}
