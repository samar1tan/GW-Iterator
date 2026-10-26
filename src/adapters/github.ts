import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {GithubAdapter,GithubObservation} from './types.ts';

const execute=promisify(execFile);
async function gh(args:string[]):Promise<string>{const result=await execute('gh',args,{timeout:20000,maxBuffer:2*1024*1024});return result.stdout;}
export function createGithubAdapter():GithubAdapter {
  return {
    async info(){try{await gh(['--version']);}catch{return{available:false,authenticated:false,error:'GitHub CLI is not available.'};}try{await gh(['auth','status']);return{available:true,authenticated:true};}catch{return{available:true,authenticated:false,error:'Sign in with gh auth login on this machine.'};}},
    async observe(repository,options){
      let runId=options.runId;
      if(!runId){const args=['run','list','--repo',repository,'--limit','1','--json','databaseId'];if(options.workflow)args.push('--workflow',options.workflow);if(options.ref)args.push('--branch',options.ref);const list=JSON.parse(await gh(args)) as {databaseId:number}[];if(!list.length)throw new Error('No matching GitHub workflow run.');runId=list[0].databaseId;}
      const value=JSON.parse(await gh(['run','view',String(runId),'--repo',repository,'--json','databaseId,displayTitle,status,conclusion,url,headSha,jobs'])) as {databaseId:number;displayTitle:string;status:string;conclusion:string;url:string;headSha:string;jobs:unknown[]};
      const status:GithubObservation['status']=value.status==='completed'?(value.conclusion==='success'?'completed':'failed'):value.status==='queued'||value.status==='waiting'?'queued':'running';
      return{status,summary:`${value.displayTitle}: ${value.status}${value.conclusion?' / '+value.conclusion:''}`,url:value.url,runId:value.databaseId,data:{headSha:value.headSha,jobs:value.jobs},artifacts:[{label:'GitHub Actions run',url:value.url}]};
    },
    async dispatch(repository,workflow,ref){
      const output=await gh(['workflow','run',workflow,'--repo',repository,'--ref',ref]);
      const match=output.match(/https:\/\/github\.com\/[^\s]+\/actions\/runs\/(\d+)/);
      if(!match)throw new Error('Workflow dispatch was submitted, but its exact run ID was not returned. Inspect GitHub before another dispatch.');
      return{status:'queued',summary:'Workflow dispatched; awaiting its actual checks.',runId:Number(match[1]),url:match[0]};
    },
  };
}
