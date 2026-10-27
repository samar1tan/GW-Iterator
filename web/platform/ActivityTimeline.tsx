import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {AuditEvent,Stage} from '../../src/contracts';
import {api} from '../api';
import {Button,Empty,ErrorNotice,Field} from '../components';
import {Icon} from '../Icons';
import {activityCategory,activityTitle,groupHumanActivity,mergeActivity} from './activity';
import type {ActivityCategory} from './activity';
import {useCopy} from './copy';
import {KnowledgeMarkdown} from '../KnowledgeMarkdown';
import {readRoute,writeRoute} from './route';

type ReadingAnchor={key:string;offset:number};
function readingAnchor(element:HTMLDivElement):ReadingAnchor|null{
  const top=element.getBoundingClientRect().top,bottom=element.getBoundingClientRect().bottom;
  const row=Array.from(element.querySelectorAll<HTMLElement>('[data-activity-key]')).find(row=>{const rect=row.getBoundingClientRect();return rect.bottom>top&&rect.top<bottom;});
  return row?{key:row.dataset.activityKey!,offset:row.getBoundingClientRect().top-top}:null;
}

export function ActivityTimeline({events,runId,stages=[],onStage,active=false}:{events:AuditEvent[];runId?:string;stages?:Stage[];onStage?:(id:string)=>void;active?:boolean}) {
  const {p,date}=useCopy(), titleId=useId();
  const [records,setRecords]=useState(()=>mergeActivity([],events)), [category,setCategory]=useState<ActivityCategory|'all'>('all'), [following,setFollowing]=useState(true), [seen,setSeen]=useState(()=>Math.max(0,...events.map(event=>event.seq))), [error,setError]=useState<unknown>(null), [technicalOpen,setTechnicalOpen]=useState(false), [query,setQuery]=useState('');
  const scroll=useRef<HTMLDivElement>(null), cursor=useRef(Math.max(0,...events.map(event=>event.seq))),followingRef=useRef(true),anchor=useRef<ReadingAnchor|null>(null);
  const rememberReading=()=>{if(!followingRef.current&&scroll.current)anchor.current=readingAnchor(scroll.current);};
  useEffect(()=>{rememberReading();setRecords(previous=>mergeActivity(previous,events));cursor.current=Math.max(cursor.current,...events.map(event=>event.seq));},[events]);
  useEffect(()=>{
    if(!runId||!active){setError(null);return;}
    const controller=new AbortController();let busy=false;
    const load=async()=>{
      if(busy||document.visibilityState==='hidden')return;busy=true;
      try{const result=await api<{events:AuditEvent[]}>(`/api/events?runId=${encodeURIComponent(runId)}&after=${cursor.current}`,{signal:controller.signal});if(!controller.signal.aborted){rememberReading();cursor.current=Math.max(cursor.current,...result.events.map(event=>event.seq));setRecords(previous=>mergeActivity(previous,result.events));setError(null);}}
      catch(value){if(!controller.signal.aborted)setError(value);}finally{busy=false;}
    };
    void load();const timer=setInterval(()=>void load(),2500);return()=>{controller.abort();clearInterval(timer);};
  },[runId,active]);
  const groups=groupHumanActivity(records), latest=groups.at(-1)?.lastSeq??0, shown=groups.filter(group=>category==='all'||activityCategory(group.event.type)===category).sort((left,right)=>right.lastSeq-left.lastSeq);
  const followLatest=()=>{followingRef.current=true;setFollowing(true);};
  useLayoutEffect(()=>{
    const element=scroll.current;if(!element)return;
    if(following){element.scrollTop=0;setSeen(latest);}
    else if(anchor.current){
      const rows=Array.from(element.querySelectorAll<HTMLElement>('[data-activity-key]')),key=Number(anchor.current.key);
      const row=rows.find(row=>row.dataset.activityKey===anchor.current!.key)??rows.find(row=>Number(row.dataset.activityKey)<=key&&Number(row.dataset.activityLast)>=key)??rows.reduce<HTMLElement|undefined>((nearest,row)=>!nearest||Math.abs(Number(row.dataset.activityKey)-key)<Math.abs(Number(nearest.dataset.activityKey)-key)?row:nearest,undefined);
      if(row)element.scrollTop+=row.getBoundingClientRect().top-element.getBoundingClientRect().top-anchor.current.offset;
    }
    anchor.current=readingAnchor(element);
  },[records,following,category]);
  const unseen=following?0:shown.filter(group=>group.lastSeq>seen).length;
  const raw=technicalOpen?records.filter(event=>`${event.type} ${event.actor} ${event.message} ${event.stageId??''} ${event.data===undefined?'':JSON.stringify(event.data)}`.toLowerCase().includes(query.toLowerCase())):[];
  return <section className="pf-activity" aria-labelledby={titleId}><div className="pf-section-heading"><h2 id={titleId}>{p('activity')}</h2><span className={`pf-live-label ${error?'sync-error':''}`}><Icon name={error?'warning':active?'refresh':'clock'}/>{p(error?'activityUpdateFailed':active?'activityUpdating':'activityHistory')}</span></div>
    <div className="pf-activity-toolbar"><div className="pf-filter-group" role="group" aria-label={p('activity')}>{(['all','work','review','system']as const).map(value=><button key={value} type="button" aria-pressed={category===value} className={category===value?'selected':''} onClick={()=>{if(value!==category){setCategory(value);followLatest();}}}>{p(value==='all'?'allActivity':value==='work'?'workActivity':value==='review'?'reviewActivity':'systemActivity')}</button>)}</div><Button tone="quiet" disabled={following} onClick={()=>{followLatest();scroll.current?.focus({preventScroll:true});}}><Icon name="arrow-up"/>{unseen?p(unseen===1?'newEvent':'newEvents',{count:unseen}):p(following?'followingActivity':'followActivity')}</Button></div>
    <ErrorNotice error={error}/><div ref={scroll} className="pf-activity-scroll" tabIndex={0} aria-label={p('events')} onScroll={event=>{const element=event.currentTarget,atLatest=element.scrollTop<=40;followingRef.current=atLatest;setFollowing(atLatest);if(atLatest)setSeen(latest);anchor.current=readingAnchor(element);}}>
      {!shown.length?<Empty>{p('noWorkflowActivity')}</Empty>:<ol className="pf-timeline">{shown.map(group=>{
        const event=group.event, stage=stages.find(item=>item.id===event.stageId), title=activityTitle(event.type), category=activityCategory(event.type), result=['stage.result','manual.completed','goal.answered','goal.completed'].includes(event.type);
        const intakeId=event.data&&typeof event.data==='object'&&'intakeId' in event.data&&typeof event.data.intakeId==='string'?event.data.intakeId:undefined;
        const documentHref=writeRoute(typeof location==='undefined'?{projectId:event.projectId??undefined,surface:'workbench',role:'',...(intakeId?{intakeId}:{runId:runId??event.runId??undefined})}:readRoute());
        return <li key={group.key} data-activity-key={group.key} data-activity-last={group.lastSeq} className={`pf-timeline-event category-${category}`}><span className="pf-timeline-icon"><Icon name={title==='eventFailed'?'warning':title==='eventCompleted'?'check':category==='review'?'check-circle':'circle'}/></span><div className="pf-timeline-content"><header><strong>{p(title)}</strong>{stage&&onStage?<button className="pf-text-button" onClick={()=>onStage(stage.id)}>{stage.name}</button>:stage&&<span>{stage.name}</span>}<time dateTime={group.lastAt}>{date(group.lastAt)}</time></header>{result?<details><summary>{p('recordedResult')}</summary><KnowledgeMarkdown content={event.message} documentHref={documentHref} idPrefix={titleId+'-'+group.key+'-'}/></details>:<><p className="pf-event-message">{event.message}</p>{event.message.length>240&&<details><summary>{p('fullMessage')}</summary><p className="pre-wrap">{event.message}</p></details>}</>}<span className="pf-event-actor">{event.actor}{group.count>1&&<> · {p('repeatedActivity',{count:group.count})}</>}</span>{event.data!==undefined&&<details><summary>{p('technical')}</summary><code>{event.type}</code><pre className="json-output">{JSON.stringify(event.data,null,2)}</pre></details>}</div></li>;
      })}</ol>}
    </div>
    <details className="pf-activity-technical" open={technicalOpen} onToggle={event=>setTechnicalOpen(event.currentTarget.open)}><summary><Icon name="terminal"/>{p('executionStream')}<span className="count">{records.length}</span></summary>{technicalOpen&&<div className="form-stack"><Field label={p('searchTechnicalRecords')}><input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></Field><div className="pf-raw-events-scroll">{!raw.length?<Empty>{p('noEvents')}</Empty>:<ol className="pf-raw-events">{raw.map(event=><li key={event.seq}><header><code>{event.type}</code><time dateTime={event.at}>{date(event.at)}</time></header><span>{event.actor}{event.stageId&&<> · {event.stageId}</>}</span><pre>{event.message}</pre>{event.data!==undefined&&<details><summary>{p('technical')}</summary><pre className="json-output">{JSON.stringify(event.data,null,2)}</pre></details>}</li>)}</ol>}</div></div>}</details>
  </section>;
}
