import {useEffect,useState} from 'react';
import type {Run} from '../../src/contracts';
import {api} from '../api';
import {Button,Empty,ErrorNotice,Modal} from '../components';
import {useCopy} from './copy';

export const usesMultica=(run:Run)=>run.stages.some(stage=>stage.attempts.some(attempt=>attempt.provider==='multica'||attempt.ref?.provider==='multica'));
export function InspectChanges({runId}:{runId:string}){const{p}=useCopy();const[open,setOpen]=useState(false);return <><Button onClick={()=>setOpen(true)}>{p('inspectChanges')}</Button>{open&&<EvidenceModal runId={runId} onClose={()=>setOpen(false)}/>}</>}
export function PreviewArtifact({runId,path}:{runId:string;path:string}){const{p}=useCopy();const[open,setOpen]=useState(false);if(path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.split(/[\\/]/).some(part=>part==='..'||part==='.git'||part==='.local'||part.startsWith('.env')))return null;return <><Button tone="quiet" onClick={()=>setOpen(true)}>{p('previewArtifact')}</Button>{open&&<EvidenceModal runId={runId} path={path} onClose={()=>setOpen(false)}/>}</>}

function EvidenceModal({runId,path,onClose}:{runId:string;path?:string;onClose:()=>void}){
 const{p}=useCopy();const[result,setResult]=useState<{sourceCommit:string;status?:string;diff?:string;content?:string;path?:string}|null>(null);const[error,setError]=useState<unknown>(null);const[read,setRead]=useState(0);
 useEffect(()=>{const controller=new AbortController();setResult(null);setError(null);void api<NonNullable<typeof result>>(`/api/runs/${encodeURIComponent(runId)}/${path===undefined?'changes':'artifacts?path='+encodeURIComponent(path)}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setResult(value)}).catch(error=>{if(!controller.signal.aborted)setError(error)});return()=>controller.abort()},[runId,path,read]);
 return <Modal wide title={path??p('inspectChanges')} onClose={onClose}><div className="form-stack"><ErrorNotice error={error}/>{result?<><dl className="metadata-list"><div><dt>{p('sourceRevision')}</dt><dd><code>{result.sourceCommit}</code></dd></div></dl>{path===undefined?<>{result.status&&<pre className="pf-source-status">{result.status}</pre>}{result.diff?<pre className="pf-source-preview">{result.diff}</pre>:<Empty>{p('noTrackedDiff')}</Empty>}</>:<pre className="pf-source-preview">{result.content}</pre>}</>:!error&&<p className="hint">{p('loading')}</p>}<div className="actions"><Button onClick={()=>setRead(value=>value+1)}>{p('refresh')}</Button><Button onClick={onClose}>{p('close')}</Button></div></div></Modal>
}
