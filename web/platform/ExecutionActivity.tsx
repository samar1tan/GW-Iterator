import {useEffect,useState} from 'react';
import type {AuditEvent,Run} from '../../src/contracts';
import {Button} from '../components';
import {Icon} from '../Icons';
import type {IconName} from '../Icons';
import {currentAttemptEvents,executionFeedback,executionSignal} from './executionFeedback';
import {mergeActivity} from './activity';
import type {ExecutionOperation} from './executionFeedback';
import {useCopy} from './copy';

const icons:Record<ExecutionOperation,IconName>={preparing:'layers',submitted:'arrow-right',queued:'clock',working:'code',command:'terminal',tool:'settings',files:'file',responding:'file',output:'terminal',commentary:'info',reported:'check-circle',human:'team',review:'shield',ci:'workflow',approval:'pause',accountCheck:'refresh',accountWait:'clock',stopping:'stop',providerWait:'clock',paused:'pause',received:'check-circle'};
const labels={preparing:'executionPreparing',submitted:'executionSubmitted',queued:'executionQueued',working:'executionWorking',command:'executionCommand',tool:'executionTool',files:'executionFiles',responding:'executionResponding',output:'executionOutput',commentary:'executionCommentary',reported:'executionReported',human:'executionHuman',review:'executionReview',ci:'executionCi',approval:'executionApproval',accountCheck:'executionAccountCheck',accountWait:'executionAccountWait',stopping:'executionStopping',providerWait:'executionProviderWait',paused:'executionPaused',received:'executionReceived'} as const;

export function ExecutionActivity({run,stageId,events,observedAt,observationFailed=false,settling=false,onOpen}:{run:Run;stageId:string;events:AuditEvent[];observedAt?:number;observationFailed?:boolean;settling?:boolean;onOpen?:()=>void}) {
  const{p,date,number}=useCopy(),[now,setNow]=useState(Date.now),[visible,setVisible]=useState(()=>typeof document==='undefined'||document.visibilityState!=='hidden');
  const state=run.stages.find(item=>item.stageId===stageId),attempt=state?.attempts.at(-1),watching=!!state&&['queued','running','waiting','review','paused'].includes(state.status);
  const [records,setRecords]=useState(()=>currentAttemptEvents(run,stageId,attempt,events).filter(executionSignal));
  useEffect(()=>{setRecords(previous=>{const merged=mergeActivity(currentAttemptEvents(run,stageId,attempt,previous),currentAttemptEvents(run,stageId,attempt,events).filter(executionSignal)),tail=merged.slice(-32),lifecycle=merged.findLast(event=>executionSignal(event)?.lifecycle);return lifecycle&&!tail.includes(lifecycle)?[lifecycle,...tail]:tail;});},[events,run.id,stageId,attempt?.id]);
  useEffect(()=>{if(!watching)return;const tick=()=>{setVisible(document.visibilityState!=='hidden');if(document.visibilityState!=='hidden')setNow(Date.now());};document.addEventListener('visibilitychange',tick);const timer=setInterval(tick,1000);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[watching]);
  const feedback=executionFeedback(run,stageId,records,{now,observedAt,observationFailed,settling});if(!feedback)return null;
  const stage=run.snapshot.pipeline.stages.find(item=>item.id===stageId)!,role=run.snapshot.project.roles.find(item=>item.id===stage.roleId);
  const duration=(seconds:number)=>seconds<60?p('executionSeconds',{count:number(seconds)}):p('executionMinutesSeconds',{minutes:number(Math.floor(seconds/60)),seconds:number(seconds%60)});
  return <section className={`pf-execution-activity${feedback.moving&&visible?' is-moving':''}${feedback.observationGap||feedback.quiet?' is-quiet':''}`} aria-label={p('currentExecution')}>
    <div className="pf-execution-current"><span className="pf-execution-operation" aria-hidden="true"><Icon name={feedback.observationGap?'warning':feedback.quiet?'clock':icons[feedback.operation]}/></span><div><h3 aria-live="polite" aria-atomic="true">{p(feedback.observationGap?'executionObservationGap':labels[feedback.operation])}</h3><span>{role?.name??stage.roleId}<span className="pf-meta-separator"/>{run.executionKind?p('executionCoordinator'):stage.name}</span></div>{onOpen&&<Button tone="quiet" onClick={onOpen} aria-label={p('openExecution')} title={p('openExecution')}><Icon name="arrow-up-right"/></Button>}</div>
    {feedback.signal?.text&&<p className="pf-execution-commentary">{feedback.signal.text}</p>}
    {feedback.signal?.tool&&<code className="pf-execution-tool">{feedback.signal.tool}</code>}
    {feedback.signal?.command&&<details className="pf-execution-command"><summary><Icon name="terminal"/><code>{feedback.signal.command}</code></summary><pre>{feedback.signal.command}</pre></details>}
    {feedback.elapsedSeconds!==undefined&&<div className="pf-execution-times"><span><Icon name="clock"/>{p('executionElapsed',{duration:duration(feedback.elapsedSeconds)})}</span>{feedback.lastActivityAt&&feedback.activitySeconds!==undefined&&<time dateTime={feedback.lastActivityAt} title={date(feedback.lastActivityAt)}>{p(feedback.quiet?'executionQuiet':'executionLastActivity',{duration:duration(feedback.activitySeconds)})}</time>}</div>}
  </section>;
}
