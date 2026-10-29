import {randomBytes,createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import type {ControlTool} from './contracts.ts';
import {TOOL_DEFINITIONS} from './adapters/codex.ts';
import {AppError,demand} from './validation.ts';
import type {BrowserToolResult} from './browser-runtime.ts';

type Lease={expiresAt?:number;tools:ControlTool[];invoke:(tool:ControlTool,args:Record<string,unknown>)=>Promise<unknown>;onRevoke?:()=>void};
/** A worker receives only its frozen role's project-scoped capabilities. */
export class ControlMcp {
  private leases=new Map<string,Lease>();private origin:string;
  constructor(origin:string){this.origin=origin;}
  issue(tools:ControlTool[],invoke:Lease['invoke'],seconds?:number,onRevoke?:()=>void){
    const secret=randomBytes(32).toString('hex'),key=this.key(secret);
    demand(seconds===undefined||Number.isFinite(seconds)&&seconds>0,'INVALID_CAPABILITY_LIFETIME','A technical capability lifetime must be positive.');
    const lease:Lease={tools:[...new Set(tools)].filter(tool=>tool in TOOL_DEFINITIONS),invoke,onRevoke,...(seconds===undefined?{}:{expiresAt:Date.now()+seconds*1000})};
    this.leases.set(key,lease);
    // The owning execution revokes this role-scoped capability when its work ends.
    return{config:{mcpServers:{gwi:{type:'http',url:this.origin+'/mcp/control',headers:{Authorization:'Bearer '+secret},default_tools_approval_mode:'approve'}}},revoke:()=>{const removed=this.leases.delete(key);if(removed)onRevoke?.();return removed;}};
  }
  private key(secret:string){return createHash('sha256').update(secret).digest('hex');}
  private lease(request:IncomingMessage){
    const header=request.headers.authorization??'',key=this.key(header.startsWith('Bearer ')?header.slice(7):'');
    const lease=this.leases.get(key);if(lease?.expiresAt!==undefined&&lease.expiresAt<=Date.now()){this.leases.delete(key);lease.onRevoke?.();}demand(lease&&this.leases.has(key),'EXPIRED_EXECUTION_CAPABILITY','This execution capability has expired or was revoked.',401);return lease;
  }
  async handle(request:IncomingMessage,response:ServerResponse){
    const lease=this.lease(request);
    demand(request.method==='POST','METHOD_NOT_ALLOWED','Use stateless MCP requests.',405);
    const server=new Server({name:'gwi-project-control',version:'0.1.0'},{capabilities:{tools:{}}});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    const names=new Map(lease.tools.map(tool=>['gwi_'+tool.replaceAll('.','_'),tool]));
    server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...names].map(([name,tool])=>({name,description:TOOL_DEFINITIONS[tool].description,annotations:{readOnlyHint:['context.read','knowledge.search','pipeline.read','run.read'].includes(tool),destructiveHint:['run.start','intake.route','pipeline.write','browser.use'].includes(tool),idempotentHint:['context.read','knowledge.search','pipeline.read','run.read','run.start'].includes(tool),openWorldHint:['run.start','intake.route','browser.use'].includes(tool)},inputSchema:{type:'object' as const,properties:TOOL_DEFINITIONS[tool].properties,required:TOOL_DEFINITIONS[tool].required,additionalProperties:false}}))}));
    server.setRequestHandler(CallToolRequestSchema,async message=>{
      try{
        this.lease(request);const tool=names.get(message.params.name);demand(tool,'TOOL_NOT_ALLOWED','This role cannot use the requested tool.',403);
        const value=await lease.invoke(tool,message.params.arguments??{});
        this.lease(request);
        if(tool==='browser.use')return value as BrowserToolResult;
        return{content:[{type:'text' as const,text:JSON.stringify(value)}]};
      }catch(error){return{isError:true,content:[{type:'text' as const,text:JSON.stringify({code:error instanceof AppError?error.code:'CONTROL_FAILED',message:error instanceof Error?error.message:'Project control failed.'})}]};}
    });
    response.once('close',()=>{void transport.close();void server.close();});
    await server.connect(transport);await transport.handleRequest(request,response);
  }
  close(){for(const lease of this.leases.values())lease.onRevoke?.();this.leases.clear();}
}
