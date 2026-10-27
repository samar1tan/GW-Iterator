import {useState} from 'react';
import type {ProjectDetail,Proposal} from '../../src/contracts';
import {api} from '../api';
import {Button,ErrorNotice,Modal} from '../components';
import {useCopy} from './copy';
import {PipelineSteps} from './PipelineSteps';
import {Icon} from '../Icons';

export function PipelineProposals({detail,onChanged,onRun}:{detail:ProjectDetail;onChanged:()=>Promise<void>;onRun:(id:string)=>void}){
 const{p}=useCopy();const[selected,setSelected]=useState<Proposal|null>(null);const[error,setError]=useState<unknown>(null);const[busy,setBusy]=useState(false);if(!detail.proposals.length)return null;
 const apply=async(proposal:Proposal)=>{setBusy(true);setError(null);try{await api(`/api/proposals/${proposal.id}/apply`,{method:'POST',body:{}});await onChanged();setSelected(null)}catch(error){setError(error)}finally{setBusy(false)}};
 return <details className="pf-proposals"><summary>{p('proposals')} · {detail.proposals.filter(item=>item.status==='pending').length}</summary><ErrorNotice error={error}/>{detail.proposals.map(proposal=><article key={proposal.id}><div><strong>{proposal.definition.name}</strong><p>{proposal.rationale}</p><span>{p('revision',{revision:proposal.baseRevision})} · {proposal.status}</span></div><Button onClick={()=>setSelected(proposal)}>{p('inspectProposal')}</Button></article>)}{selected&&<Modal wide title={p('inspectProposal')} onClose={()=>setSelected(null)}><div className="form-stack"><ErrorNotice error={error}/><p className="pre-wrap">{selected.rationale}</p><ProposalPreview proposal={selected} detail={detail}/>{selected.runId&&<Button onClick={()=>{setSelected(null);onRun(selected.runId!)}}>{p('sourceExecution')}<Icon name="arrow-right"/></Button>}<div className="actions"><Button onClick={()=>setSelected(null)}>{p('close')}</Button>{selected.status==='pending'&&<Button tone="primary" disabled={busy} onClick={()=>void apply(selected)}>{p('applyProposal')}</Button>}</div></div></Modal>}</details>
}

function ProposalPreview({proposal,detail}:{proposal:Proposal;detail:ProjectDetail}) {const {p}=useCopy();const [id,setId]=useState(proposal.definition.stages[0]?.id);const stage=proposal.definition.stages.find(item=>item.id===id);return <div className="pf-proposal-content"><PipelineSteps pipeline={proposal.definition} roles={detail.project.roles} selectedId={id} onSelect={setId}/>{stage&&<section className="panel form-stack"><h3>{stage.name}</h3><p className="pre-wrap">{stage.prompt}</p>{!!stage.checks?.length&&<ul className="pf-check-contract">{stage.checks.map((check,index)=><li key={index}>{check}</li>)}</ul>}<details><summary>{p('technical')}</summary><pre className="json-output">{JSON.stringify(stage,null,2)}</pre></details></section>}</div>;}
