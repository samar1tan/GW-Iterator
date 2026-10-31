import type {Executor,Pipeline,Stage} from '../../src/contracts';

/** Unknown child definitions stay conservative; resolvable human workflows need no model. */
export function workflowScope(pipeline:Pipeline,pipelines:Pipeline[]=[]){
  const modelRoles=new Set<string>();
  const inspect=(current:Pipeline,parents:Set<string>):{requiresAccount:boolean;manualOnly:boolean}=>{
    if(parents.has(current.id))return {requiresAccount:true,manualOnly:false};
    const next=new Set(parents).add(current.id);
    let requiresAccount=false,manualOnly=true;
    for(const stage of current.stages){
      if(stage.executor==='codex'){requiresAccount=true;manualOnly=false;modelRoles.add(stage.roleId);}
      else if(stage.executor==='pipeline'){
        const child=pipelines.find(item=>item.id===stage.options?.pipelineId);
        const scope=child?inspect(child,next):{requiresAccount:true,manualOnly:false};
        requiresAccount ||= scope.requiresAccount;manualOnly &&= scope.manualOnly;
      }else if(stage.executor!=='manual')manualOnly=false;
    }
    return {requiresAccount,manualOnly};
  };
  return {...inspect(pipeline,new Set()),modelRoles};
}

/** Action changes cannot retain an invisible contract for a different executor. */
export function switchStageExecutor(stage:Stage,executor:Executor):Stage {
  return {...stage,executor,options:undefined,executionPurpose:executor==='codex'?stage.executionPurpose:undefined,ownerGate:executor==='manual'?stage.ownerGate:undefined,deliveryPreparation:executor==='codex'?stage.deliveryPreparation:undefined};
}
