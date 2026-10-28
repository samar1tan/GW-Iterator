import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,mkdtemp,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import type {Browser,BrowserContext,Page,LaunchOptions} from 'playwright-core';
import {parseBrowserOrigins} from './browser-policy.ts';
import {browserProxy} from './browser-proxy.ts';
import {AppError,demand,isObject} from './validation.ts';

export type BrowserScope={projectId:string;runId:string;stageId:string;attemptId:string;workspace:string;origins:string[]};
export type BrowserObservation={id:string;projectId:string;runId:string;stageId:string;workspace:string;origins:string[];status:'starting'|'ready'|'failed'|'closed';cleanupConfirmed:boolean;operations:number;blockedRequests:number;updatedAt:string;action?:string;operationId?:string;url?:string;title?:string;screenshot?:string;error?:string};
export type BrowserToolResult={content:({type:'text';text:string}|{type:'image';data:string;mimeType:string})[]};
export type BrowserLease={invoke:(args:Record<string,unknown>)=>Promise<BrowserToolResult>;close:()=>Promise<void>;observation:()=>BrowserObservation};
type Launch=(options:LaunchOptions)=>Promise<Browser>;
type Observe=(value:BrowserObservation)=>void;
const fields=['action','url','selector','text','key','width','height','files'];
const actions=['open','snapshot','click','fill','press','resize','upload','drop','paste','screenshot','close'];
const inside=(root:string,file:string)=>file.startsWith(root+path.sep);
const now=()=>new Date().toISOString();

/** Host-side browser authority is narrower than the worker's native command API. */
export class BrowserRuntime {
  private directory:string;private blockedPorts:Set<string>;private sessions=new Set<BrowserLease>();private stopping=false;
  private launch:Launch;
  constructor(directory:string,blockedOrigins:string[],launch:Launch=options=>chromium.launch(options)){
    this.directory=directory;this.blockedPorts=new Set(blockedOrigins.map(origin=>{const url=new URL(origin);return url.port||(url.protocol==='https:'?'443':'80');}));this.launch=launch;
  }
  async prepare(scope:BrowserScope,signal:AbortSignal,observe:Observe=()=>{}):Promise<BrowserLease>{
    demand(!this.stopping&&!signal.aborted,'BROWSER_CLOSED','The execution browser is closed.',409);
    const origins=parseBrowserOrigins(scope.origins);
    demand(origins,'BROWSER_ORIGIN_REQUIRED','Enable browser testing on this role and set exact local test origins before starting a new execution.',409);
    demand(origins.every(origin=>!this.blockedPorts.has(new URL(origin).port)),'BROWSER_CONTROL_ORIGIN','The browser cannot access GWI, Multica or runtime control ports. Use a separate local test server.',403);
    const root=await realpath(scope.workspace);
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const directory=await mkdtemp(path.join(await realpath(this.directory),'session-'));
    let browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined,closed=false,failed=false,closing:Promise<void>|undefined,proxy:Awaited<ReturnType<typeof browserProxy>>|undefined;
    let queue:Promise<unknown>=Promise.resolve();
    let record:BrowserObservation={id:scope.attemptId,projectId:scope.projectId,runId:scope.runId,stageId:scope.stageId,workspace:root,origins:[...origins],status:'starting',cleanupConfirmed:false,operations:0,blockedRequests:0,updatedAt:now()};
    const publish=(change:Partial<BrowserObservation>)=>{record={...record,...change,updatedAt:now()};observe(structuredClone(record));};
    const active=()=>demand(!closed&&!failed&&!this.stopping&&!signal.aborted,'BROWSER_CLOSED','This browser session ended. Start a new explicitly authorized execution to use another session.',409);
    const allowed=(value:string)=>{try{const url=new URL(value);return url.protocol==='http:'&&!url.username&&!url.password&&origins.includes(url.origin)&&!this.blockedPorts.has(url.port);}catch{return false;}};
    const blocked=()=>publish({blockedRequests:record.blockedRequests+1});
    const close=()=>{
      closed=true;signal.removeEventListener('abort',abort);
      if(closing)return closing;
      closing=(async()=>{
        try{await proxy?.close();await browser?.close();publish({status:failed?'failed':'closed',cleanupConfirmed:!!browser});}
        catch{publish({status:'failed',cleanupConfirmed:false,error:'Browser cleanup could not be confirmed.'});}
      })();return closing;
    };
    const abort=()=>{void lease.close();};signal.addEventListener('abort',abort,{once:true});
    const filePayloads=async(value:unknown)=>{
      demand(Array.isArray(value)&&value.length>0&&value.every(file=>typeof file==='string'),'INVALID_BROWSER_FILES','Choose execution-relative files.');
      const payloads:{name:string;mimeType:string;buffer:Buffer}[]=[];let total=0;
      for(const relative of value as string[]){
        active();
        demand(relative.length<=4096&&!path.isAbsolute(relative)&&relative.split(/[\\/]/).every(part=>part.length>0&&part!=='.'&&part!=='..'&&!part.startsWith('.')),'BROWSER_FILE_SCOPE','Browser input files must use non-hidden execution-relative paths.',403);
        const file=await realpath(path.join(root,relative));demand(inside(root,file)&&path.relative(root,file).split(path.sep).every(part=>!part.startsWith('.')),'BROWSER_FILE_SCOPE','Browser input files must remain inside this execution workspace and outside hidden/private directories.',403);
        const before=await lstat(file);demand(before.isFile()&&before.nlink===1&&before.size<=10*1024*1024,'BROWSER_FILE_SCOPE','Choose an ordinary, unlinked input file of at most 10 MiB.',403);
        const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try{
          const stat=await handle.stat();demand(stat.isFile()&&stat.nlink===1&&stat.dev===before.dev&&stat.ino===before.ino&&stat.size<=10*1024*1024,'BROWSER_FILE_SCOPE','The browser input changed during inspection.',403);
          const actual=await realpath(file),current=await lstat(actual);demand(actual===file&&inside(root,actual)&&current.dev===stat.dev&&current.ino===stat.ino,'BROWSER_FILE_SCOPE','The browser input path changed during inspection.',403);
          const buffer=Buffer.alloc(stat.size+1),read=await handle.read(buffer,0,buffer.length,0);demand(read.bytesRead===stat.size,'BROWSER_FILE_CHANGED','The browser input changed during reading.',409);
          const after=await handle.stat(),afterPath=await realpath(file),afterFile=await lstat(afterPath);demand(afterPath===file&&afterFile.dev===stat.dev&&afterFile.ino===stat.ino&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&after.nlink===1,'BROWSER_FILE_CHANGED','The browser input changed during reading.',409);
          total+=read.bytesRead;demand(total<=32*1024*1024,'BROWSER_FILES_TOO_LARGE','A browser input transfer must not exceed 32 MiB.',413);
          const name=path.basename(relative),ext=path.extname(name).toLowerCase();const mimeType=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf'} as Record<string,string>)[ext]??'application/octet-stream';
          payloads.push({name,mimeType,buffer:buffer.subarray(0,read.bytesRead)});
        }finally{await handle.close();}
      }
      return payloads;
    };
    const invoke=async(args:Record<string,unknown>):Promise<BrowserToolResult>=>{
      active();demand(isObject(args)&&Object.keys(args).every(key=>fields.includes(key))&&typeof args.action==='string'&&actions.includes(args.action),'INVALID_BROWSER_ACTION','Choose a supported browser action.');
      const action=args.action;
      if(action==='close'){await close();return{content:[{type:'text',text:JSON.stringify(record)}]};}
      demand(page&&context,'BROWSER_UNAVAILABLE','The host browser is unavailable.',409);
      const target=()=>{demand(typeof args.selector==='string'&&args.selector.length>0&&args.selector.length<=2000&&!args.selector.includes('>>'),'INVALID_BROWSER_SELECTOR','Use one CSS selector.');return page!.locator('css='+args.selector);};
      let screenshot:Buffer|undefined,screenshotPath:string|undefined;
      try{
        if(action==='open'){demand(typeof args.url==='string'&&args.url.length<=4096&&allowed(args.url),'BROWSER_ORIGIN_NOT_ALLOWED','Choose a URL in this role\'s allowed local test origins.',403);const response=await page.goto(args.url,{waitUntil:'domcontentloaded'});demand(!response?.headers()['x-gwi-browser-denied'],'BROWSER_REQUEST_BLOCKED','The browser blocked a redirect or download. Navigate explicitly to an allowed local test URL.',403);}
        else if(action==='click')await target().click();
        else if(action==='fill'){demand(typeof args.text==='string'&&args.text.length<=64000,'INVALID_BROWSER_TEXT','Provide text of at most 64,000 characters.');await target().fill(args.text);}
        else if(action==='press'){demand(typeof args.key==='string'&&args.key.length<=100,'INVALID_BROWSER_KEY','Provide a browser key.');await page.keyboard.press(args.key);}
        else if(action==='resize'){demand(Number.isInteger(args.width)&&Number.isInteger(args.height)&&Number(args.width)>=240&&Number(args.width)<=2400&&Number(args.height)>=240&&Number(args.height)<=2000,'INVALID_BROWSER_VIEWPORT','Use viewport dimensions between 240 and 2400 by 2000 pixels.');await page.setViewportSize({width:Number(args.width),height:Number(args.height)});}
        else if(['upload','drop','paste'].includes(action)){
          const element=target(),payloads=await filePayloads(args.files);active();
          if(action==='upload')await element.setInputFiles(payloads);
          else{
            const files=payloads.map(file=>({name:file.name,mimeType:file.mimeType,data:file.buffer.toString('base64')}));
            await element.evaluate((element,{files,action})=>{
              const transfer=new DataTransfer();for(const file of files){const bytes=Uint8Array.from(atob(file.data),character=>character.charCodeAt(0));transfer.items.add(new File([bytes],file.name,{type:file.mimeType}));}
              if(action==='paste')element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
              else for(const type of ['dragenter','dragover','drop'])element.dispatchEvent(new DragEvent(type,{dataTransfer:transfer,bubbles:true,cancelable:true}));
            },{files,action});
          }
        }else if(action==='screenshot'){
          screenshot=await page.screenshot({type:'png',fullPage:false});demand(screenshot.length<=2*1024*1024,'BROWSER_IMAGE_TOO_LARGE','The screenshot exceeds the two MiB response boundary.',413);active();
          screenshotPath=path.join(directory,randomUUID()+'.png');const file=await open(screenshotPath,'wx',0o600);try{await file.writeFile(screenshot);}finally{await file.close();}
        }
        active();const url=page.url();demand(url==='about:blank'||allowed(url),'BROWSER_ORIGIN_NOT_ALLOWED','The page left its authorized origin.',403);
        const receipt={operationId:randomUUID(),action,actionCompleted:true,url,...(screenshotPath?{screenshot:screenshotPath}:{})};
        // Record the completed action before a separate page observation can fail.
        publish({status:'ready',operations:record.operations+1,action,operationId:receipt.operationId,url,...(screenshotPath?{screenshot:screenshotPath}:{})});
        let observation:Record<string,unknown>;
        try{
          const title=await page.title(),snapshot=(await page.locator('body').ariaSnapshot()).slice(0,32000),viewport=page.viewportSize();active();publish({title,error:undefined});observation={title,viewport,snapshot};
        }catch{
          active();const observationError='The action completed, but the page observation is unavailable. Use snapshot to inspect the current state before considering another action; do not replay the acknowledged action.';
          publish({error:observationError});observation={observationError};
        }
        return{content:[{type:'text',text:JSON.stringify({...receipt,...observation,blockedRequests:record.blockedRequests})},...(screenshot?[{type:'image' as const,data:screenshot.toString('base64'),mimeType:'image/png'}]:[])]};
      }catch(error){
        if(error instanceof AppError)throw error;
        throw new AppError('BROWSER_ACTION_FAILED','The browser action failed: '+(error instanceof Error?error.message.split('\n')[0].slice(0,400):'Inspect the local test page.'),409);
      }
    };
    const lease:BrowserLease={invoke:args=>{const next=queue.then(()=>invoke(args));queue=next.catch(()=>{});return next;},close:async()=>{await close();this.sessions.delete(lease);},observation:()=>structuredClone(record)};
    this.sessions.add(lease);publish({});
    try{
      proxy=await browserProxy(allowed,blocked);if(closed||signal.aborted||this.stopping){await proxy.close();active();}active();
      browser=await this.launch({channel:'chrome',headless:true,chromiumSandbox:true,downloadsPath:directory,timeout:12000,args:['--webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-quic'],proxy:{server:proxy.server,username:proxy.username,password:proxy.password,bypass:proxy.bypass}});
      if(closed||signal.aborted||this.stopping){await browser.close();publish({status:'closed',cleanupConfirmed:true});throw new AppError('BROWSER_CLOSED','The execution ended during browser startup.',409);}
      context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:720}});context.setDefaultTimeout(8000);context.setDefaultNavigationTimeout(12000);
      await context.route('**/*',async route=>{
        if(closed||!allowed(route.request().url())){blocked();await route.abort('blockedbyclient').catch(()=>{});return;}
        await route.continue().catch(()=>{});
      });
      // All WebSockets are blocked: a second handshake must not bypass HTTP redirect checks.
      await context.routeWebSocket('**/*',socket=>{blocked();socket.close();});
      context.on('page',popup=>{if(page&&popup!==page)void popup.close();popup.on('download',download=>{void download.cancel();});popup.on('dialog',dialog=>{void dialog.dismiss();});});
      page=await context.newPage();active();publish({status:'ready'});return lease;
    }catch(error){
      failed=!closed;publish({status:closed?'closed':'failed',error:error instanceof AppError?error.message:'Chrome could not start on the GWI host. Install Chrome and start GWI outside the restricted worker shell.'});
      await proxy?.close();await lease.close();if(error instanceof AppError)throw error;
      throw new AppError('BROWSER_START_FAILED','Chrome could not start on the GWI host. Install Chrome and start GWI outside the restricted worker shell; keep the worker permissions unchanged.',409);
    }
  }
  async close(){this.stopping=true;await Promise.allSettled([...this.sessions].map(session=>session.close()));}
}
