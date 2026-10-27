import {useState} from 'react';
import {runPolicy} from '../../src/contracts';
import type {Run} from '../../src/contracts';
import {api} from '../api';
import {Button,ErrorNotice,Field,Modal} from '../components';
import {useCopy} from './copy';

export function RunLimits({run,disabled,onChanged}:{run:Run;disabled:boolean;onChanged:()=>Promise<void>}) {
  const {p}=useCopy(),[open,setOpen]=useState(false);
  return <section className="pf-stage-decision"><h3>{p('executionBounds')}</h3><Button disabled={disabled||!['failed','interrupted','cancelled'].includes(run.status)} onClick={()=>setOpen(true)}>{p('editExecutionBounds')}</Button>{open&&<LimitForm run={run} onClose={()=>setOpen(false)} onChanged={onChanged}/>}</section>;
}
function LimitForm({run,onClose,onChanged}:{run:Run;onClose:()=>void;onChanged:()=>Promise<void>}) {
  const {p}=useCopy(),[basis,setBasis]=useState(()=>({base:{...runPolicy(run)},revision:run.limitRevisions?.length??0})),{base,revision}=basis,stale=(run.limitRevisions?.length??0)!==revision;
  const [limits,setLimits]=useState({maxAttempts:base.maxAttempts,timeoutSeconds:base.timeoutSeconds,maxIterations:base.maxIterations}),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  const changed=Object.entries(limits).some(([key,value])=>value>base[key as keyof typeof limits]);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError(null);try{await api(`/api/runs/${encodeURIComponent(run.id)}/limits`,{method:'POST',body:{expectedRevision:revision,limits,note}});await onChanged();onClose();}catch(error){setError(error);}finally{setBusy(false);}};
  const fields=[['maxAttempts','attempts',5],['timeoutSeconds','seconds',3600],['maxIterations','iterations',10]]as const;
  return <Modal title={p('editExecutionBounds')} onClose={onClose}><form className="form-stack" onSubmit={event=>void submit(event)}><p className="hint">{p('accountBoundsEffect')}</p><ErrorNotice error={error}/>{stale&&<section><p className="hint">{p('limitBasisChanged')}</p><Button onClick={()=>{const policy=runPolicy(run);setBasis({base:{...policy},revision:run.limitRevisions?.length??0});setLimits({maxAttempts:policy.maxAttempts,timeoutSeconds:policy.timeoutSeconds,maxIterations:policy.maxIterations});}}>{p('reloadLimits')}</Button></section>}{fields.map(([key,label,max])=><Field key={key} label={p(label)}><input type="number" required min={base[key]} max={max} value={limits[key]} onChange={event=>setLimits({...limits,[key]:Number(event.target.value)})}/></Field>)}<Field label={p('limitReason')}><textarea required rows={3} value={note} onChange={event=>setNote(event.target.value)}/></Field><div className="form-actions"><Button onClick={onClose}>{p('cancel')}</Button><Button type="submit" tone="primary" disabled={busy||stale||!changed||!note.trim()}>{p('saveLimits')}</Button></div></form></Modal>;
}
