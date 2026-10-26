import {useState} from 'react';
import type {ProjectDetail,Proposal} from '../../src/contracts';
import {api} from '../api';
import {Button,ErrorNotice,Modal} from '../components';
import {useCopy} from './copy';
import {PipelineCanvas} from './PipelineCanvas';

export function PipelineProposals({detail,onChanged,onRun}:{detail:ProjectDetail;onChanged:()=>Promise<void>;onRun:(id:string)=>void}){
 const{p}=useCopy();const[selected,setSelected]=useState<Proposal|null>(null);const[error,setError]=useState<unknown>(null);const[busy,setBusy]=useState(false);if(!detail.proposals.length)return null;
 const apply=async(proposal:Proposal)=>{setBusy(true);setError(null);try{await api(`/api/proposals/${proposal.id}/apply`,{method:'POST',body:{}});await onChanged();setSelected(null)}catch(error){setError(error)}finally{setBusy(false)}};
 return <details className="pf-proposals"><summary>{p('proposals')} · {detail.proposals.filter(item=>item.status==='pending').length}</summary><ErrorNotice error={error}/>{detail.proposals.map(proposal=><article key={proposal.id}><div><strong>{proposal.definition.name}</strong><p>{proposal.rationale}</p><span>{p('revision',{revision:proposal.baseRevision})} · {proposal.status}</span></div><Button onClick={()=>setSelected(proposal)}>{p('inspectProposal')}</Button></article>)}{selected&&<Modal wide title={p('inspectProposal')} onClose={()=>setSelected(null)}><div className="form-stack"><ErrorNotice error={error}/><p className="pre-wrap">{selected.rationale}</p><div className="pf-proposal-preview"><PipelineCanvas pipeline={selected.definition} roles={detail.project.roles} selectedId={selected.definition.stages[0]?.id} onSelect={()=>{}}/></div>{selected.runId&&<Button onClick={()=>{setSelected(null);onRun(selected.runId!)}}>{p('sourceExecution')} →</Button>}<div className="actions"><Button onClick={()=>setSelected(null)}>{p('close')}</Button>{selected.status==='pending'&&<Button tone="primary" disabled={busy} onClick={()=>void apply(selected)}>{p('applyProposal')}</Button>}</div></div></Modal>}</details>
}
