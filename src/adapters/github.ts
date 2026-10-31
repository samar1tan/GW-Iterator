import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {GithubAdapter,GithubObservation} from './types.ts';

const execute=promisify(execFile);
async function gh(args:string[]):Promise<string>{const result=await execute('gh',args,{timeout:20000,maxBuffer:2*1024*1024});return result.stdout;}
export function createGithubAdapter():GithubAdapter {
  return {
    async publication(repository,url){
      const parsed=new URL(url),parts=parsed.pathname.split('/').filter(Boolean);
      if(parsed.origin!=='https://github.com'||parsed.username||parsed.password||parts.slice(0,2).join('/').toLowerCase()!==repository.toLowerCase()||!/^\d+$/.test(parts.at(-1)??''))return{url,status:'reported'};
      if(parts.length===4&&parts[2]==='pull'){
        const value=JSON.parse(await gh(['pr','view',parts[3],'--repo',repository,'--json','url,state,headRefOid,statusCheckRollup'])) as {url:string;state:string;headRefOid:string;statusCheckRollup:{name?:string;context?:string;status?:string;state?:string;conclusion?:string;detailsUrl?:string;targetUrl?:string}[]};
        return{url:value.url,status:'observed',state:value.state,headSha:value.headRefOid,checks:(value.statusCheckRollup??[]).map(check=>({name:check.name??check.context??'Check',status:check.status??check.state??'UNKNOWN',...(check.conclusion?{conclusion:check.conclusion}:{}),...((check.detailsUrl??check.targetUrl)?{url:check.detailsUrl??check.targetUrl}:{})}))};
      }
      if(parts.length===5&&parts[2]==='actions'&&parts[3]==='runs'){
        const value=JSON.parse(await gh(['run','view',parts[4],'--repo',repository,'--json','url,status,conclusion,headSha,displayTitle'])) as {url:string;status:string;conclusion:string;headSha:string;displayTitle:string};
        return{url:value.url,status:'observed',headSha:value.headSha,checks:[{name:value.displayTitle,status:value.status,conclusion:value.conclusion,url:value.url}]};
      }
      return{url,status:'reported'};
    },
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
