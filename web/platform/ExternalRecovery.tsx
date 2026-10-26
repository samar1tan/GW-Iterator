import {useEffect,useState} from 'react';
import {api} from '../api';
import {Button,ErrorNotice} from '../components';
import {useCopy} from './copy';

type ExternalExecution={id:string;stageId:string;status:string;cleanupConfirmed:boolean;taskId?:string;issueId?:string;updatedAt?:string};
export function useExternalRecovery({runId,stageId,attemptId,enabled,coordinator,onChanged}:{runId:string;stageId:string;attemptId?:string;enabled:boolean;coordinator:boolean;onChanged:()=>Promise<void>}){
 const{p}=useCopy();const[record,setRecord]=useState<ExternalExecution>();const[loading,setLoading]=useState(enabled);const[busy,setBusy]=useState(false);const[error,setError]=useState<unknown>(null);const[read,setRead]=useState(0);
 useEffect(()=>{if(!enabled){setLoading(false);return}const controller=new AbortController();setLoading(true);setError(null);void api<{executions:ExternalExecution[]}>(`/api/runs/${encodeURIComponent(runId)}/executions`,{signal:controller.signal}).then(result=>{if(!Array.isArray(result.executions))throw new Error(p('externalStateUnavailable'));if(!controller.signal.aborted)setRecord(result.executions.find(item=>item.id===attemptId)??result.executions.filter(item=>item.stageId===stageId||coordinator).at(-1))}).catch(error=>{if(!controller.signal.aborted)setError(error)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[runId,stageId,attemptId,enabled,coordinator,read]);
 const reconcile=async()=>{setBusy(true);setError(null);try{const result=await api<ExternalExecution>(`/api/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageId)}/reconcile`,{method:'POST',body:{}});setRecord(result);await onChanged()}catch(error){setError(error)}finally{setBusy(false)}};
 return{record,loading,busy,error,reconcile,refresh:()=>setRead(value=>value+1)};
}

export function ExternalRecovery({value}:{value:ReturnType<typeof useExternalRecovery>}){const{p}=useCopy();return <section className="pf-stage-decision"><h3>{p('externalState')}</h3><ErrorNotice error={value.error}/>{value.loading?<p className="hint">{p('loading')}</p>:<><p className="hint">{p(value.record?.cleanupConfirmed?'externalEnded':'externalUnconfirmed')}</p>{value.record&&<dl className="metadata-list"><div><dt>{p('externalStatus')}</dt><dd>{value.record.status}</dd></div></dl>}<div className="actions"><Button disabled={value.busy} onClick={()=>void value.reconcile()}>{value.busy?p('checking'):p('reconcileExternal')}</Button>{!!value.error&&<Button onClick={value.refresh}>{p('refresh')}</Button>}</div><p className="hint">{p('reconcileHelp')}</p></>}</section>}
