import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,mkdtemp,readFile,stat,realpath,lstat,readlink,symlink,writeFile,chmod,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Project,WorkspaceReadiness} from './contracts.ts';
import {Store} from './store.ts';
import {demand,AppError} from './validation.ts';

const execute=promisify(execFile);
export type ExecutionWorkspace={id:string;projectId:string;path:string;sourcePath:string;sourceCommit:string;createdAt:string};
export type VerificationEntry={path:string;kind:'file'|'symlink'|'deleted';tracked:boolean;sha256?:string;size?:number;mode?:number;target?:string};
export type VerificationManifest={version:1;preparedCommit:string;entries:VerificationEntry[];excluded:{path:string;reason:'private-runtime'}[];sha256:string};
export type VerificationCheck={unchanged:boolean;manifestHash:string;observedHash?:string;changed:string[];errorCode?:string};
export type VerificationWorkspace={id:string;projectId:string;runId:string;path:string;executionPath:string;projectPath:string;sourceCommit:string;manifest:VerificationManifest;createdAt:string;disposedAt?:string;checkedAt?:string;unchanged?:boolean};
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const within=(root:string,filename:string)=>filename.startsWith(root+path.sep);
const privatePath=(relative:string)=>relative.split('/').some(part=>['.git','.local','node_modules','.cache','.gwi-verification'].includes(part)||part.startsWith('.env')&&!['.env.example','.env.sample','.env.template'].includes(part));
const safeRelative=(relative:string)=>relative.length>0&&!path.isAbsolute(relative)&&!relative.includes('\\')&&!relative.split('/').some(part=>!part||part==='.'||part==='..');
const gitOptions={timeout:10000,maxBuffer:8*1024*1024,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}};

/** Observe the selected repository without initializing, committing or running hooks. */
export async function inspectWorkspace(workspace:string):Promise<WorkspaceReadiness>{
  const root=await realpath(workspace).catch(()=>null);
  if(!root||!(await stat(root).catch(()=>null))?.isDirectory())return{status:'blocked',code:'WORKSPACE_UNAVAILABLE'};
  const args=['-C',root,'-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null'];
  let top:string;
  try{top=(await execute('git',[...args,'rev-parse','--show-toplevel'],gitOptions)).stdout.trim();}
  catch(error){const code=(error as NodeJS.ErrnoException).code;return code==='ENOENT'?{status:'unavailable',code:'GIT_UNAVAILABLE'}:typeof code==='number'?{status:'blocked',code:'GIT_REPOSITORY_REQUIRED'}:{status:'unavailable',code:'GIT_INSPECTION_FAILED'};}
  if(await realpath(top).catch(()=>null)!==root)return{status:'blocked',code:'GIT_ROOT_MISMATCH'};
  try{const sourceCommit=(await execute('git',[...args,'rev-parse','--verify','HEAD^{commit}'],gitOptions)).stdout.trim();return /^[a-f0-9]{40,64}$/.test(sourceCommit)?{status:'ready',code:'READY',sourceCommit}:{status:'blocked',code:'GIT_COMMIT_REQUIRED'};}
  catch{return{status:'blocked',code:'GIT_COMMIT_REQUIRED'};}
}

export async function requireWorkspaceReady(project:Pick<Project,'workspace'>):Promise<WorkspaceReadiness>{
  const result=await inspectWorkspace(project.workspace);
  if(result.status!=='ready')throw new AppError(result.code,'Use the root of a Git repository with a committed HEAD before starting model-backed work.',409,{workspace:result});
  return result;
}

/** Check out committed input without copying private, ignored runtime state. */
export class Workspaces {
  private pending=new Map<string,Promise<ExecutionWorkspace>>();
  private verifying=new Map<string,Promise<VerificationWorkspace>>();
  private store:Store; private root:string;
  constructor(store:Store,root:string){this.store=store;this.root=root;}
  ensure(project:Project,runId:string):Promise<ExecutionWorkspace>{
    const known=this.store.get<ExecutionWorkspace>('execution-workspace',runId);if(known)return Promise.resolve(known);
    const current=this.pending.get(runId);if(current)return current;
    const work=this.prepare(project,runId).finally(()=>this.pending.delete(runId));this.pending.set(runId,work);return work;
  }
  get(runId:string){const record=this.store.get<ExecutionWorkspace>('execution-workspace',runId);demand(record,'EXECUTION_WORKSPACE_UNAVAILABLE','This run has no local execution checkout.',409);return record;}
  verification(attemptId:string){const record=this.store.get<VerificationWorkspace>('verification-workspace',attemptId);demand(record,'VERIFICATION_WORKSPACE_UNAVAILABLE','This attempt has no verification copy.',409);return record;}
  /** Capture the prepared checkout, including deletions and nonignored new source. */
  prepareVerification(project:Project,runId:string,attemptId:string):Promise<VerificationWorkspace>{
    const known=this.store.get<VerificationWorkspace>('verification-workspace',attemptId);if(known){demand(known.projectId===project.id&&known.runId===runId&&!known.disposedAt,'VERIFICATION_SCOPE_CONFLICT','This verification identity cannot be reused.',409);return Promise.resolve(known);}
    const pending=this.verifying.get(attemptId);if(pending)return pending.then(record=>{demand(record.projectId===project.id&&record.runId===runId,'VERIFICATION_SCOPE_CONFLICT','This verification identity belongs to another run.',409);return record;});
    const prepared=this.copyVerification(project,runId,attemptId).finally(()=>this.verifying.delete(attemptId));this.verifying.set(attemptId,prepared);return prepared;
  }
  async checkVerification(attemptId:string):Promise<VerificationCheck>{
    const record=this.verification(attemptId);demand(!record.disposedAt,'VERIFICATION_WORKSPACE_UNAVAILABLE','This verification copy has already been disposed.',409);
    let observed:VerificationManifest;
    try{observed=await this.snapshot(record.path,record.manifest.preparedCommit);}catch(error){record.checkedAt=new Date().toISOString();record.unchanged=false;this.store.put('verification-workspace',record);return{unchanged:false,manifestHash:record.manifest.sha256,changed:[],errorCode:error instanceof AppError?error.code:'VERIFICATION_INTEGRITY_UNAVAILABLE'};}
    const unchanged=observed.sha256===record.manifest.sha256;
    const expected=new Map(record.manifest.entries.map(entry=>[entry.path,entry])),actual=new Map(observed.entries.map(entry=>[entry.path,entry]));
    const changed=[...new Set([...expected.keys(),...actual.keys()])].filter(key=>JSON.stringify(expected.get(key))!==JSON.stringify(actual.get(key)));
    record.checkedAt=new Date().toISOString();record.unchanged=unchanged;this.store.put('verification-workspace',record);return{unchanged,manifestHash:record.manifest.sha256,observedHash:observed.sha256,changed};
  }
  async disposeVerification(attemptId:string){const record=this.verification(attemptId);if(record.disposedAt)return;await rm(record.path,{recursive:true,force:true});record.disposedAt=new Date().toISOString();this.store.put('verification-workspace',record);}
  async changes(runId:string){
    const record=this.get(runId),root=await realpath(record.path),options={...gitOptions,maxBuffer:2*1024*1024};
    const preparedCommit=(await execute('git',['-C',record.path,'rev-parse','HEAD'],options)).stdout.trim(),manifest=await this.snapshot(record.path,preparedCommit);
    // A fresh observation index cannot trust the candidate's hidden-file flags or stat cache.
    const temporary=await mkdtemp(path.join(tmpdir(),'gwi-source-observation-'));
    let status:string,diff:string;
    try{
      const observation={...options,env:{...options.env,GIT_INDEX_FILE:path.join(temporary,'index')}},[tree,index]=await Promise.all([execute('git',['-C',root,'ls-tree','-rz',preparedCommit],options),execute('git',['-C',root,'ls-files','--stage','-z'],options)]),entries=new Map<string,string>();
      for(const row of tree.stdout.split('\0').filter(Boolean)){const tab=row.indexOf('\t'),[mode,,hash]=row.slice(0,tab).split(' '),relative=row.slice(tab+1);entries.set(relative,`${mode} ${hash} 0\t${relative}`);}
      for(const row of index.stdout.split('\0').filter(Boolean)){const relative=row.slice(row.indexOf('\t')+1);if(!entries.has(relative))entries.set(relative,row);}
      const build=execute('git',['-C',root,'update-index','-z','--index-info'],observation);build.child.stdin!.end([...entries.values()].join('\0')+'\0');await build;
      const values=await Promise.all([execute('git',['-C',root,'-c','core.fsmonitor=false','status','--short'],observation),execute('git',['-C',root,'-c','core.fsmonitor=false','diff','--no-ext-diff','--no-textconv',record.sourceCommit,'--'],observation)]);status=values[0].stdout;diff=values[1].stdout;
    }finally{await rm(temporary,{recursive:true,force:true});}
    const untracked=[];let total=0;
    for(const entry of manifest.entries.filter(entry=>!entry.tracked)){
      let content:string|undefined;
      if(entry.kind==='file'&&entry.size!<=512*1024&&total+entry.size!<=2*1024*1024){const bytes=await this.sourceBytes(root,entry.path);if(!bytes.includes(0)){content=bytes.toString('utf8');total+=bytes.length;}}
      untracked.push({path:entry.path,kind:entry.kind,...(content!==undefined?{content}:{previewUnavailable:true})});
    }
    demand((await this.snapshot(record.path,preparedCommit)).sha256===manifest.sha256,'REVIEW_INPUT_CHANGED','Prepared source changed during inspection. Refresh before deciding.',409);
    return{sourceCommit:record.sourceCommit,preparedCommit,manifestHash:manifest.sha256,status,diff,untracked};
  }
  async artifact(runId:string,relative:string){
    demand(relative.length>0&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).some(part=>part==='..'||part==='.git'||part==='.local'||part.startsWith('.env')),'INVALID_ARTIFACT_PATH','Choose an artifact inside this execution checkout.');
    const record=this.get(runId),root=await realpath(record.path),filename=await realpath(path.resolve(root,relative)).catch(()=>{throw new AppError('ARTIFACT_NOT_FOUND','The recorded artifact is missing from this checkout.',404);});
    demand(filename.startsWith(root+path.sep),'INVALID_ARTIFACT_PATH','The artifact resolves outside this execution checkout.',403);
    const file=await stat(filename);demand(file.isFile()&&file.size<=512*1024,'ARTIFACT_NOT_PREVIEWABLE','Text preview supports files up to 512 KiB.',409);
    const bytes=await readFile(filename);demand(!bytes.includes(0),'ARTIFACT_NOT_PREVIEWABLE','This artifact is not a text document.',409);return{path:relative,content:bytes.toString('utf8'),sourceCommit:record.sourceCommit};
  }
  private async prepare(project:Project,runId:string):Promise<ExecutionWorkspace>{
    demand([project.id,runId].every(value=>/^[\w-]+$/.test(value)),'INVALID_EXECUTION_ID','Invalid execution identity.');
    const inspected=await requireWorkspaceReady(project),sourcePath=await realpath(project.workspace),sourceCommit=inspected.sourceCommit!;
    const target=path.join(this.root,project.id,runId);await mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await execute('git',['-c','core.hooksPath=/dev/null','clone','--no-local','--no-checkout','--',sourcePath,target],{timeout:60000,maxBuffer:1024*1024});
    await execute('git',['-C',target,'-c','core.hooksPath=/dev/null','checkout','--detach',sourceCommit],{timeout:30000});
    const record:ExecutionWorkspace={id:runId,projectId:project.id,path:target,sourcePath,sourceCommit,createdAt:new Date().toISOString()};
    this.store.put('execution-workspace',record);return record;
  }
  private async copyVerification(project:Project,runId:string,attemptId:string):Promise<VerificationWorkspace>{
    demand([project.id,runId,attemptId].every(value=>/^[\w-]+$/.test(value)),'INVALID_EXECUTION_ID','Invalid execution identity.');
    const checkout=await this.ensure(project,runId),executionPath=await realpath(checkout.path),projectPath=await realpath(project.workspace);
    const preparedCommit=(await execute('git',['-C',executionPath,'rev-parse','HEAD'],gitOptions)).stdout.trim();
    demand(/^[a-f0-9]{40,64}$/.test(preparedCommit),'INVALID_SOURCE_REVISION','A committed checkout revision is required.');
    const manifest=await this.snapshot(executionPath,preparedCommit),parent=path.join(this.root,project.id);await mkdir(parent,{recursive:true,mode:0o700});
    const root=await realpath(parent),target=path.join(root,runId+'-verify-'+attemptId);
    const ignoredProjectState=!within(projectPath,target)||(await execute('git',['-C',projectPath,'check-ignore','--quiet','--no-index','--',path.relative(projectPath,target)],gitOptions).then(()=>true,()=>false));
    demand(!within(executionPath,target)&&ignoredProjectState&&target!==executionPath&&target!==projectPath,'VERIFICATION_SCOPE_CONFLICT','The verification copy must use independent application state, outside original source or in its ignored runtime directory.',409);
    await mkdir(target,{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code==='EEXIST')throw new AppError('VERIFICATION_SCOPE_CONFLICT','This verification directory already exists. Reconcile the earlier attempt before creating another copy.',409);throw error;});
    try{
      await execute('git',['-c','core.hooksPath=/dev/null','clone','--no-local','--no-checkout','--',executionPath,target],{...gitOptions,timeout:60000});
      await execute('git',['-C',target,'-c','core.hooksPath=/dev/null','checkout','--detach',preparedCommit],{...gitOptions,timeout:30000});
      for(const entry of manifest.entries){
        const filename=path.join(target,entry.path);await rm(filename,{force:true,recursive:true});
        if(entry.kind==='deleted')continue;
        await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
        if(entry.kind==='symlink')await symlink(entry.target!,filename);
        else{const bytes=await this.sourceBytes(executionPath,entry.path);demand(digest(bytes)===entry.sha256,'VERIFICATION_INPUT_CHANGED','Prepared source changed while the verification copy was captured.',409);await writeFile(filename,bytes,{flag:'wx',mode:entry.mode});await chmod(filename,entry.mode!);}
      }
      const tracked=manifest.entries.filter(entry=>entry.tracked&&entry.kind!=='deleted').map(entry=>entry.path);
      for(let offset=0;offset<tracked.length;offset+=200)await execute('git',['-C',target,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','add','--force','--intent-to-add','--',...tracked.slice(offset,offset+200)],gitOptions);
      demand((await this.snapshot(executionPath,preparedCommit)).sha256===manifest.sha256&&(await this.snapshot(target,preparedCommit)).sha256===manifest.sha256,'VERIFICATION_INPUT_CHANGED','Prepared source changed while the verification copy was captured.',409);
      const record:VerificationWorkspace={id:attemptId,projectId:project.id,runId,path:target,executionPath,projectPath,sourceCommit:checkout.sourceCommit,manifest,createdAt:new Date().toISOString()};this.store.put('verification-workspace',record);return record;
    }catch(error){await rm(target,{recursive:true,force:true});throw error;}
  }
  private async sourceBytes(root:string,relative:string){
    const filename=path.join(root,relative),resolved=await realpath(filename);demand(within(root,resolved),'VERIFICATION_UNSAFE_PATH','Prepared source resolves outside its checkout.',409);
    const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const file=await handle.stat();demand(file.isFile()&&file.size<=16*1024*1024,'VERIFICATION_INPUT_LIMIT','Verification supports regular source files up to 16 MiB.',409);const bytes=await handle.readFile();demand(bytes.length<=16*1024*1024,'VERIFICATION_INPUT_LIMIT','Verification supports regular source files up to 16 MiB.',409);demand(await realpath(filename)===resolved,'VERIFICATION_INPUT_CHANGED','Prepared source changed while it was read.',409);return bytes;}finally{await handle.close();}
  }
  private async snapshot(directory:string,preparedCommit:string):Promise<VerificationManifest>{
    const root=await realpath(directory);
    const [head,index,other,unmerged]=await Promise.all([
      execute('git',['-C',root,'ls-tree','-r','--name-only','-z',preparedCommit],gitOptions),execute('git',['-C',root,'-c','core.fsmonitor=false','ls-files','--cached','-z'],gitOptions),
      execute('git',['-C',root,'-c','core.fsmonitor=false','ls-files','--others','--exclude-standard','-z'],gitOptions),execute('git',['-C',root,'-c','core.fsmonitor=false','ls-files','--unmerged','-z'],gitOptions)
    ]);
    demand(!unmerged.stdout,'VERIFICATION_UNMERGED_INPUT','Resolve conflicted source before independent verification.',409);
    const committed=new Set(head.stdout.split('\0').filter(Boolean)),tracked=new Set([...committed,...index.stdout.split('\0').filter(Boolean)]),paths=[...new Set([...tracked,...other.stdout.split('\0').filter(Boolean)])].sort();
    demand(paths.length<=10000,'VERIFICATION_INPUT_LIMIT','This verification input exceeds 10,000 source paths.',409);
    const entries:VerificationEntry[]=[],excluded:VerificationManifest['excluded']=[];let total=0;
    for(const relative of paths){
      if(privatePath(relative)){demand(!tracked.has(relative),'VERIFICATION_PRIVATE_INPUT','Tracked private or runtime state cannot enter a verification copy.',409);excluded.push({path:relative,reason:'private-runtime'});continue;}
      demand(safeRelative(relative),'VERIFICATION_UNSAFE_PATH','Prepared source has an unsafe path.',409);
      const filename=path.join(root,relative),file=await lstat(filename).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
      if(!file){if(committed.has(relative))entries.push({path:relative,kind:'deleted',tracked:true});continue;}
      if(file.isSymbolicLink()){
        const target=await readlink(filename),resolved=await realpath(filename).catch(()=>undefined),lexical=path.resolve(path.dirname(filename),target),targetPath=path.relative(root,lexical).split(path.sep).join('/');
        demand(!path.isAbsolute(target)&&!!resolved&&within(root,resolved)&&within(root,lexical)&&safeRelative(targetPath)&&!privatePath(targetPath)&&(paths.includes(targetPath)||paths.some(item=>item.startsWith(targetPath+'/'))),'VERIFICATION_UNSAFE_SYMLINK','A prepared symlink escapes the included verification source.',409);
        entries.push({path:relative,kind:'symlink',tracked:tracked.has(relative),target,sha256:digest(target)});continue;
      }
      demand(file.isFile(),'VERIFICATION_UNSUPPORTED_INPUT','Verification input contains an unsupported source entry.',409);
      const bytes=await this.sourceBytes(root,relative);total+=bytes.length;demand(total<=64*1024*1024,'VERIFICATION_INPUT_LIMIT','This verification input exceeds 64 MiB.',409);
      entries.push({path:relative,kind:'file',tracked:tracked.has(relative),sha256:digest(bytes),size:bytes.length,mode:file.mode&0o777});
    }
    const value={version:1 as const,preparedCommit,entries};return{...value,excluded,sha256:digest(JSON.stringify(value))};
  }
}
