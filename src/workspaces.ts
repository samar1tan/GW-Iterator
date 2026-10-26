import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {Project} from './contracts.ts';
import {Store} from './store.ts';
import {demand,AppError} from './validation.ts';

const execute=promisify(execFile);
export type ExecutionWorkspace={id:string;projectId:string;path:string;sourcePath:string;sourceCommit:string;createdAt:string};

/** Check out committed input without copying private, ignored runtime state. */
export class Workspaces {
  private pending=new Map<string,Promise<ExecutionWorkspace>>();
  private store:Store; private root:string;
  constructor(store:Store,root:string){this.store=store;this.root=root;}
  ensure(project:Project,runId:string):Promise<ExecutionWorkspace>{
    const known=this.store.get<ExecutionWorkspace>('execution-workspace',runId);if(known)return Promise.resolve(known);
    const current=this.pending.get(runId);if(current)return current;
    const work=this.prepare(project,runId).finally(()=>this.pending.delete(runId));this.pending.set(runId,work);return work;
  }
  get(runId:string){const record=this.store.get<ExecutionWorkspace>('execution-workspace',runId);demand(record,'EXECUTION_WORKSPACE_UNAVAILABLE','This run has no local execution checkout.',409);return record;}
  async changes(runId:string){
    const record=this.get(runId),options={timeout:10000,maxBuffer:1024*1024};
    const [status,diff]=await Promise.all([execute('git',['-C',record.path,'status','--short'],options),execute('git',['-C',record.path,'diff','--no-ext-diff','--no-textconv','HEAD','--'],options)]);
    return{sourceCommit:record.sourceCommit,status:status.stdout,diff:diff.stdout};
  }
  async artifact(runId:string,relative:string){
    demand(relative.length>0&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).some(part=>part==='..'||part==='.git'||part==='.local'||part.startsWith('.env')),'INVALID_ARTIFACT_PATH','Choose an artifact inside this execution checkout.');
    const record=this.get(runId),root=await realpath(record.path),filename=await realpath(path.resolve(root,relative)).catch(()=>{throw new AppError('ARTIFACT_NOT_FOUND','The recorded artifact is missing from this checkout.',404);});
    demand(filename.startsWith(root+path.sep),'INVALID_ARTIFACT_PATH','The artifact resolves outside this execution checkout.',403);
    const file=await stat(filename);demand(file.isFile()&&file.size<=512*1024,'ARTIFACT_NOT_PREVIEWABLE','Text preview supports files up to 512 KiB.',409);
    const bytes=await readFile(filename);demand(!bytes.includes(0),'ARTIFACT_NOT_PREVIEWABLE','This artifact is not a text document.',409);return{path:relative,content:bytes.toString('utf8'),sourceCommit:record.sourceCommit};
  }
  private async prepare(project:Project,runId:string):Promise<ExecutionWorkspace>{
    demand(/^[\w-]+$/.test(runId),'INVALID_EXECUTION_ID','Invalid execution identity.');
    const sourcePath=await realpath(project.workspace);
    const sourceCommit=(await execute('git',['-C',sourcePath,'rev-parse','HEAD'],{timeout:10000})).stdout.trim();
    demand(/^[a-f0-9]{40,64}$/.test(sourceCommit),'INVALID_SOURCE_REVISION','A committed project revision is required.');
    const target=path.join(this.root,project.id,runId);await mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await execute('git',['-c','core.hooksPath=/dev/null','clone','--no-local','--no-checkout','--',sourcePath,target],{timeout:60000,maxBuffer:1024*1024});
    await execute('git',['-C',target,'-c','core.hooksPath=/dev/null','checkout','--detach',sourceCommit],{timeout:30000});
    const record:ExecutionWorkspace={id:runId,projectId:project.id,path:target,sourcePath,sourceCommit,createdAt:new Date().toISOString()};
    this.store.put('execution-workspace',record);return record;
  }
}
