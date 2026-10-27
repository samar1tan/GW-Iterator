import {useId,useRef,useState} from 'react';
import type {Pipeline,Project,Run,Stage} from '../../src/contracts';
import {EFFORT_LABELS} from '../../src/contracts';
import {api,uid} from '../api';
import {Button,ErrorNotice,Field,Modal} from '../components';
import {Icon} from '../Icons';
import type {IconName} from '../Icons';
import {ProjectReadinessNotice,useProjectReadiness} from './ProjectReadiness';
import {workflowScope} from './workflowScope';
import {useCopy} from './copy';
import type {AllowanceAssessment} from '../../src/account-allowance-types';
import {AccountAllowance,canRequestAccountStep,accountStepNeedsApproval,accountStepAuthorization} from './AccountAllowance';
import {useTextDraft} from './useTextDraft';
import {submittedDraftKey} from './workStart';
import {requestEnterAction} from './requestKeys';

export function LaunchPipeline({pipeline,pipelines=[],project,onClose,onStarted}:{pipeline:Pipeline;pipelines?:Pipeline[];project:Project;onClose:()=>void;onStarted:(run:Run)=>Promise<void>}) {
  const {p,number}=useCopy(),formId=useId();
  const composing=useRef(false);
  const [goal,setGoal,clearGoal]=useTextDraft(`pipeline:${project.id}:${pipeline.id}`),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[storedKey,setStoredKey,clearStoredKey]=useTextDraft(`pipeline-key:${project.id}:${pipeline.id}`),[account,setAccount]=useState<AllowanceAssessment|null>(null);
  const {requiresAccount,manualOnly,modelRoles:scopeRoles}=workflowScope(pipeline,pipelines);
  const readiness=useProjectReadiness(project,requiresAccount),sourceBlocked=requiresAccount&&readiness.readiness?.workspace.status!=='ready';
  const modelRoles=project.roles.filter(role=>scopeRoles.has(role.id));
  const models=[...new Set(modelRoles.map(role=>p('modelSummary',{model:role.model??p('defaultModel'),effort:EFFORT_LABELS[role.effort]})))];
  const disabled=busy||!goal.trim()||sourceBlocked||(requiresAccount&&!canRequestAccountStep(account));
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!goal.trim()||busy||sourceBlocked||(requiresAccount&&!canRequestAccountStep(account)))return;
    setBusy(true);setError(null);const submission=submittedDraftKey(goal.trim(),storedKey,uid);setStoredKey(JSON.stringify(submission));
    try{const run=await api<Run>('/api/runs',{method:'POST',body:{projectId:project.id,pipelineId:pipeline.id,goal:goal.trim(),idempotencyKey:submission.key,resourceMode:'account',...(requiresAccount?accountStepAuthorization(account):{})}});clearGoal(goal);clearStoredKey(JSON.stringify(submission));await onStarted(run);}catch(value){setError(value);}finally{setBusy(false);}
  };
  const footer=<><Button onClick={onClose} disabled={busy}>{p('cancel')}</Button><Button form={formId} type="submit" tone="primary" disabled={disabled}><Icon name="play"/>{p(busy?'starting':requiresAccount&&accountStepNeedsApproval(account)?'approveAndStart':'startWork')}</Button></>;
  return <Modal title={p('launchPipeline',{name:pipeline.name})} busy={busy} onClose={onClose} footer={footer}>
    <form id={formId} className="pf-launch-form" onSubmit={event=>void submit(event)}>
      <ErrorNotice error={error}/>{requiresAccount&&<ProjectReadinessNotice {...readiness}/>}
      <Field label={p('launchTask')}><textarea id={formId+'-task'} autoFocus required rows={3} value={goal} placeholder={p('launchTaskPlaceholder')} onChange={event=>setGoal(event.target.value)} aria-keyshortcuts="Enter Meta+Enter Control+Enter" aria-describedby={formId+'-keys'} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{const action=requestEnterAction(event.nativeEvent,composing.current);if(action==='native')return;event.preventDefault();if(action==='submit'&&!disabled)event.currentTarget.form?.requestSubmit();}}/></Field>
      <span className="pf-request-keys" id={formId+'-keys'}>{p('requestKeysHint')}</span>
      <LaunchPath pipeline={pipeline} project={project}/>
      {modelRoles.length>0&&<div className="pf-launch-models" aria-label={p('roleDefaults')}><Icon name="cpu"/><span>{models.length===1?models[0]:p('modelConfigurationCount',{count:models.length})}</span></div>}
      {manualOnly&&<p className="pf-launch-manual"><Icon name="team"/>{p('humanWorkflow')}</p>}
      {requiresAccount&&<AccountAllowance context={{projectId:project.id,pipelineId:pipeline.id}} onAssessment={setAccount}/>}
      <details className="pf-launch-details"><summary><Icon name="settings"/>{p('technical')}<Icon name="chevron-down" className="pf-launch-disclosure"/></summary>
        <dl className="metadata-list"><div><dt>{p('seconds')}</dt><dd>{number(pipeline.policy.timeoutSeconds)}</dd></div><div><dt>{p('attempts')}</dt><dd>{pipeline.policy.maxAttempts}</dd></div></dl>
        {modelRoles.length>0&&<ul className="pf-launch-role-details">{modelRoles.map(role=><li key={role.id}><strong>{role.name}</strong><span>{p('modelSummary',{model:role.model??p('defaultModel'),effort:EFFORT_LABELS[role.effort]})}</span><span className="muted">{p(role.sandbox==='read-only'?'readSourceBoundary':'writeWorkspaceBoundary')}</span></li>)}</ul>}
      </details>
    </form>
  </Modal>;
}

function LaunchPath({pipeline,project}:{pipeline:Pipeline;project:Project}) {
  const {p}=useCopy(),stages=pipeline.stages;
  const serial=stages.every((stage,index)=>!stage.condition&&(index===0?!stage.dependsOn.length:stage.dependsOn.length===1&&stage.dependsOn[0]===stages[index-1].id));
  const indexOf=(id:string)=>{const index=stages.findIndex(stage=>stage.id===id);return index<0?id:String(index+1);};
  const nameOf=(id:string)=>stages.find(stage=>stage.id===id)?.name??id;
  const icon=(stage:Stage):IconName=>stage.executor==='manual'?'team':stage.executor==='github'?'check-circle':stage.executor==='pipeline'?'workflow':stage.executionPurpose==='review'||project.roles.find(role=>role.id===stage.roleId)?.sandbox==='read-only'?'shield':'code';
  const executor=(stage:Stage)=>p(stage.executor==='manual'?'humanTask':stage.executor==='github'?'ciTask':stage.executor==='pipeline'?'childTask':'agentTask');
  return <ol className={`pf-launch-path${serial?' is-serial':''}`} aria-label={p('steps')}>
    {stages.map((stage,index)=><li key={stage.id}>
      <span className="pf-launch-step-icon" title={executor(stage)} aria-label={executor(stage)} role="img"><Icon name={icon(stage)}/></span>
      <div className="pf-launch-step-copy"><strong><span className="pf-launch-step-index">{index+1}.</span>{stage.name}</strong><span>{project.roles.find(role=>role.id===stage.roleId)?.name??stage.roleId}</span></div>
      <div className="pf-launch-relations">
        {!serial&&stage.dependsOn.length>0&&<span title={p('dependencies')+': '+stage.dependsOn.map(nameOf).join(', ')} aria-label={p('dependencies')+': '+stage.dependsOn.map(nameOf).join(', ')}><Icon name="arrow-right"/>{stage.dependsOn.map(indexOf).join(', ')}</span>}
        {stage.condition&&<span title={p('condition')+': '+nameOf(stage.condition.stageId)}>{indexOf(stage.condition.stageId)} = {p(stage.condition.outcome==='done'?'outcomeDone':stage.condition.outcome==='no_change'?'outcomeNoChange':stage.condition.outcome==='revise'?'outcomeRevise':'outcomeBlocked')}</span>}
        {stage.reworkTo&&<span title={p('returnTo')+': '+nameOf(stage.reworkTo)} aria-label={p('returnTo')+': '+nameOf(stage.reworkTo)}><Icon name="undo"/>{indexOf(stage.reworkTo)}</span>}
      </div>
    </li>)}
  </ol>;
}
