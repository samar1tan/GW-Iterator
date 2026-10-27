import type {Pipeline, RoleProfile, Run, Stage} from '../../src/contracts';
import {StateIcon} from '../Icons';
import {Status} from '../components';
import {useCopy} from './copy';

export function orderedStages(stages: Stage[]): Stage[] {
  const output: Stage[] = [], visited = new Set<string>(), visiting = new Set<string>();
  const visit = (stage: Stage) => {if (visited.has(stage.id) || visiting.has(stage.id)) return; visiting.add(stage.id); for (const id of stage.dependsOn) {const dependency = stages.find(item => item.id === id); if (dependency) visit(dependency);} visiting.delete(stage.id); visited.add(stage.id); output.push(stage);};
  for (const stage of stages) visit(stage);
  return output;
}
export function PipelineSteps({pipeline, roles, run, selectedId, onSelect}: {pipeline: Pipeline; roles: RoleProfile[]; run?: Run; selectedId?: string; onSelect: (id: string) => void}) {
  const {p} = useCopy(), stages = orderedStages(pipeline.stages);
  return <ol className="pf-step-list" aria-label={p('steps')} onKeyDown={event => {
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.pf-step-button'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    buttons[index]?.focus();
  }}>{stages.map((stage,index) => {
    const state = run?.stages.find(item => item.stageId === stage.id), attempt = state?.attempts.at(-1), artifacts = attempt?.output?.artifacts.length ?? 0;
    const action = stage.executor === 'codex' ? 'agentTask' : stage.executor === 'manual' ? 'humanTask' : stage.executor === 'github' ? 'ciTask' : 'childTask';
    return <li key={stage.id}><button className={`pf-step-button ${selectedId === stage.id ? 'selected' : ''} ${state ? 'state-'+state.status : ''}`} data-state={state?.status} aria-pressed={selectedId === stage.id} onClick={() => onSelect(stage.id)}><span className="pf-step-marker">{run ? <StateIcon status={state?.status}/> : index + 1}</span><span className="pf-step-body"><span className="pf-step-title"><strong>{stage.name}</strong>{state && <Status value={state.status}/>}</span><span className="pf-step-owner">{roles.find(role => role.id === stage.roleId)?.name ?? stage.roleId}<span className="pf-meta-separator"/>{p(action)}</span>{(attempt?.output?.summary || attempt?.error) && <span className="pf-step-summary">{state?.status==='queued'&&attempt.output&&<>{p('previousResult')}: </>}{attempt.output?.summary ?? attempt.error}</span>}{!run && stage.prompt && <span className="pf-step-summary">{stage.prompt}</span>}<span className="pf-step-meta">{!!stage.dependsOn.length && <span>{p('dependencies')}: {stage.dependsOn.map(id => pipeline.stages.find(item => item.id === id)?.name ?? id).join(', ')}</span>}{artifacts > 0 && <span>{p('artifacts')} {artifacts}</span>}{!!stage.checks?.length && <span>{p('checks')} {stage.checks.length}</span>}{stage.review && <span>{p('reviewGate')}</span>}</span></span></button></li>;
  })}</ol>;
}
