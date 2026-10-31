import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createSocket} from 'node:dgram';
import type {Server} from 'node:http';
import {mkdtemp,mkdir,rm,writeFile,symlink,link,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import type {Browser} from 'playwright-core';
import {BrowserRuntime} from '../src/browser-runtime.ts';
import type {BrowserScope,BrowserToolResult} from '../src/browser-runtime.ts';
import {browserProxy} from '../src/browser-proxy.ts';
import {parseBrowserOrigins} from '../src/browser-policy.ts';
import {AppError} from '../src/validation.ts';

const code=(value:string)=>(error:unknown)=>error instanceof AppError&&error.code===value;
const content=(value:BrowserToolResult)=>JSON.parse(value.content.filter(part=>part.type==='text')[0].text);
async function listen(t:TestContext,server:Server){
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});return'http://127.0.0.1:'+address.port;
}
async function directory(t:TestContext){const root=await mkdtemp(path.join(tmpdir(),'gwi-browser-test-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'workspace'));return root;}
function scope(root:string,origins=['http://127.0.0.1:45678']):BrowserScope{return{projectId:'synthetic-project',runId:'synthetic-run',stageId:'verify',attemptId:'synthetic-attempt',workspace:path.join(root,'workspace'),origins};}

test('browser bindings accept exact literal loopback origins and reject ambiguous authority',()=>{
  assert.deepEqual(parseBrowserOrigins(['http://127.0.0.1:45678','http://[::1]:45679']),['http://127.0.0.1:45678','http://[::1]:45679']);
  for(const origins of [[],['https://127.0.0.1:45678'],['http://localhost:45678'],['http://127.1:45678'],['http://127.0.0.1:45678/'],['http://127.0.0.1:45678/path'],['http://127.0.0.1:45678?x=1'],['http://user@127.0.0.1:45678'],['http://127.0.0.1:80'],['http://example.invalid:45678']])assert.equal(parseBrowserOrigins(origins),null,JSON.stringify(origins));
});

test('retained screenshots read only server-owned regular PNG evidence within the private browser root',async t=>{
  const base=await directory(t),root=await realpath(base),browserRoot=path.join(root,'browser'),session=path.join(browserRoot,'session-synthetic');await mkdir(session,{recursive:true});
  const runtime=new BrowserRuntime(browserRoot,[]),file=path.join(session,'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');await writeFile(file,png);
  const record={id:'synthetic-attempt',...scope(root),status:'closed' as const,cleanupConfirmed:true,operations:1,blockedRequests:0,updatedAt:'2026-01-01T00:00:00Z',screenshot:file};
  assert.deepEqual(await runtime.recordedScreenshot(record),png);
  const outside=path.join(root,'outside.png');await writeFile(outside,png);await assert.rejects(runtime.recordedScreenshot({...record,screenshot:outside}),code('BROWSER_EVIDENCE_UNAVAILABLE'));
  const alias=path.join(session,'11111111-2222-3333-4444-555555555555.png');await symlink(file,alias);await assert.rejects(runtime.recordedScreenshot({...record,screenshot:alias}),code('BROWSER_EVIDENCE_UNAVAILABLE'));await rm(alias);await link(file,alias);await assert.rejects(runtime.recordedScreenshot(record),code('BROWSER_EVIDENCE_UNAVAILABLE'));await rm(alias);
  await writeFile(file,'Synthetic private non-image.');await assert.rejects(runtime.recordedScreenshot(record),code('BROWSER_EVIDENCE_UNAVAILABLE'));await rm(file);await assert.rejects(runtime.recordedScreenshot(record),code('BROWSER_EVIDENCE_UNAVAILABLE'));
});

test('host proxy requires its session identity, streams responses and never forwards a redirect or another origin',async t=>{
  let forbiddenHits=0,allowedHits=0;const forbidden=await listen(t,createServer((_request,response)=>{forbiddenHits++;response.end('Forbidden synthetic server.');}));
  const allowed=await listen(t,createServer((request,response)=>{allowedHits++;if(request.url==='/redirect'){response.writeHead(302,{location:forbidden});response.end();}else{assert.equal(request.headers['proxy-authorization'],undefined);response.write('first chunk\n');setImmediate(()=>response.end('second chunk\n'));}}));
  let blocked=0;const proxy=await browserProxy(url=>new URL(url).origin===allowed,()=>blocked++);t.after(()=>proxy.close());
  const call=(target:string,authenticate=true)=>new Promise<{status:number;body:string}>((resolve,reject)=>{
    const request=httpRequest(proxy.server,{path:target,headers:authenticate?{'proxy-authorization':'Basic '+Buffer.from(proxy.username+':'+proxy.password).toString('base64')}:{}} ,response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode!,body}));});request.on('error',reject);request.end();
  });
  assert.equal((await call(allowed,false)).status,407);assert.equal(allowedHits,0);
  assert.deepEqual(await call(allowed),{status:200,body:'first chunk\nsecond chunk\n'});
  assert.equal((await call(allowed+'/redirect')).status,403);assert.equal(forbiddenHits,0);
  assert.equal((await call(forbidden)).status,403);assert.equal(forbiddenHits,0);assert.equal(blocked,2);
});

test('cancel during launch closes the late browser and never creates a page or replacement session',async t=>{
  const root=await directory(t),controller=new AbortController();let started!:()=>void,release!:(browser:Browser)=>void;
  const launched=new Promise<void>(resolve=>started=resolve),pending=new Promise<Browser>(resolve=>release=resolve);let closes=0;
  const runtime=new BrowserRuntime(path.join(root,'private'),[],async options=>{assert.equal(options.chromiumSandbox,true);assert.equal(options.proxy?.bypass,'<-loopback>');started();return pending;});t.after(()=>runtime.close());
  const prepared=runtime.prepare(scope(root),controller.signal);await launched;controller.abort();
  release({close:async()=>{closes++;},newContext:async()=>assert.fail('A cancelled launch cannot create a browser context.')} as unknown as Browser);
  await assert.rejects(prepared,code('BROWSER_CLOSED'));assert.ok(closes>=1);
});

test('control ports are rejected across loopback aliases before any Chrome launch',async t=>{
  const root=await directory(t);let launches=0;const runtime=new BrowserRuntime(path.join(root,'private'),['http://localhost:45678'],async()=>{launches++;throw new Error('Must not launch.');});t.after(()=>runtime.close());
  for(const origin of ['http://127.0.0.1:45678','http://[::1]:45678'])await assert.rejects(runtime.prepare(scope(root,[origin]),new AbortController().signal),code('BROWSER_CONTROL_ORIGIN'));
  assert.equal(launches,0);await assert.rejects(runtime.prepare(scope(root,[]),new AbortController().signal),code('BROWSER_ORIGIN_REQUIRED'));
});

test('a completed click retains its receipt when the later page snapshot fails',async t=>{
  const root=await directory(t);let clicks=0;
  const page={url:()=>'http://127.0.0.1:45678',title:async()=>'Synthetic receipt page',locator:()=>({click:async()=>{clicks++;},ariaSnapshot:async()=>{throw new Error('Synthetic observation unavailable after accepted action.');}})};
  const context={setDefaultTimeout(){},setDefaultNavigationTimeout(){},route:async()=>{},routeWebSocket:async()=>{},on(){},newPage:async()=>page};
  const runtime=new BrowserRuntime(path.join(root,'private'),[],async()=>({newContext:async()=>context,close:async()=>{}} as unknown as Browser));t.after(()=>runtime.close());
  const lease=await runtime.prepare(scope(root),new AbortController().signal),result=content(await lease.invoke({action:'click',selector:'button'}));
  assert.equal(clicks,1);assert.equal(result.actionCompleted,true);assert.ok(result.operationId);assert.match(result.observationError,/do not replay/);assert.equal(lease.observation().operations,1);assert.equal(lease.observation().operationId,result.operationId);
  await lease.invoke({action:'snapshot'});assert.equal(clicks,1);await lease.close();
});

test('real hosted Chrome operates through its proxy, confines input files and returns actual images',{skip:process.env.GWI_TEST_BROWSER!=='1'},async t=>{
  const root=await directory(t);let forbiddenHits=0;const forbidden=await listen(t,createServer((_request,response)=>{forbiddenHits++;response.end('Forbidden.');}));
  const udp=createSocket('udp4');let udpPackets=0;udp.on('message',()=>udpPackets++);await new Promise<void>(resolve=>udp.bind(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>udp.close(()=>resolve())));const udpPort=udp.address().port;
  const origin=await listen(t,createServer((request,response)=>{
    if(request.url==='/redirect'){response.writeHead(302,{location:forbidden});response.end();return;}
    if(request.url==='/stream'){response.writeHead(200,{'content-type':'text/event-stream'});response.write('data: observed-stream\n\n');return;}
    response.writeHead(200,{'content-type':'text/html'});response.end(`<!doctype html><title>Synthetic browser journey</title><button onclick="this.textContent='Clicked'">Click me</button><input aria-label="Text"><input type="file" onchange="document.querySelector('output').textContent=this.files[0].name"><div id="files" tabindex="0">Drop or paste here</div><output></output><div id="stream"></div><script>const target=document.querySelector('#files');for(const type of ['drop','paste'])target.addEventListener(type,event=>{event.preventDefault();const files=event.dataTransfer?.files??event.clipboardData.files;document.querySelector('output').textContent=type+':'+files[0].name;});new EventSource('/stream').onmessage=event=>document.querySelector('#stream').textContent=event.data;const peer=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udpPort}'}]});peer.createDataChannel('synthetic');peer.createOffer().then(offer=>peer.setLocalDescription(offer));</script>`);
  }));
  const observations:unknown[]=[],runtime=new BrowserRuntime(path.join(root,'private'),[]);t.after(()=>runtime.close());
  const controller=new AbortController(),lease=await runtime.prepare(scope(root,[origin]),controller.signal,value=>observations.push(value));
  await lease.invoke({action:'open',url:origin});await lease.invoke({action:'click',selector:'button'});
  let seen=content(await lease.invoke({action:'snapshot'}));assert.match(seen.snapshot,/Clicked/);assert.match(seen.snapshot,/observed-stream/);
  await lease.invoke({action:'fill',selector:'input[aria-label="Text"]',text:'Synthetic retained text'});
  const resized=content(await lease.invoke({action:'resize',width:375,height:812}));assert.deepEqual(resized.viewport,{width:375,height:812});
  await writeFile(path.join(root,'workspace','sample.txt'),'Synthetic browser input.');
  await lease.invoke({action:'upload',selector:'input[type="file"]',files:['sample.txt']});assert.match(content(await lease.invoke({action:'snapshot'})).snapshot,/sample.txt/);
  for(const action of ['drop','paste']){const result=content(await lease.invoke({action,selector:'#files',files:['sample.txt']}));assert.match(result.snapshot,new RegExp(action+':sample.txt'));}
  await writeFile(path.join(root,'outside.txt'),'Outside this execution.');await symlink(path.join(root,'outside.txt'),path.join(root,'workspace','escape.txt'));await link(path.join(root,'outside.txt'),path.join(root,'workspace','linked.txt'));
  await mkdir(path.join(root,'workspace','.local'));await writeFile(path.join(root,'workspace','.local','private.txt'),'Private synthetic input.');await symlink(path.join(root,'workspace','.local','private.txt'),path.join(root,'workspace','hidden-link.txt'));
  for(const file of ['../outside.txt','.env','escape.txt','linked.txt','hidden-link.txt'])for(const action of ['upload','drop','paste'])await assert.rejects(lease.invoke({action,selector:'input[type="file"]',files:[file]}),code('BROWSER_FILE_SCOPE'));
  await assert.rejects(lease.invoke({action:'open',url:forbidden}),code('BROWSER_ORIGIN_NOT_ALLOWED'));assert.equal(forbiddenHits,0);
  await assert.rejects(lease.invoke({action:'open',url:origin+'/redirect'}),code('BROWSER_REQUEST_BLOCKED'));assert.equal(forbiddenHits,0);
  await lease.invoke({action:'open',url:origin});const shot=await lease.invoke({action:'screenshot'}),image=shot.content.find(part=>part.type==='image');assert.ok(image&&image.type==='image');assert.equal(image.mimeType,'image/png');assert.ok(Buffer.from(image.data,'base64').length>100);assert.ok((await readFile(content(shot).screenshot)).equals(Buffer.from(image.data,'base64')));
  controller.abort();await lease.close();assert.equal(lease.observation().cleanupConfirmed,true);await assert.rejects(lease.invoke({action:'snapshot'}),code('BROWSER_CLOSED'));
  assert.equal(udpPackets,0,'Page WebRTC must not send STUN packets outside the authenticated proxy.');
  assert.ok(observations.length>5);
});
