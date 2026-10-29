import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import type {Socket} from 'node:net';
import type {OutgoingHttpHeaders} from 'node:http';

/** The proxy preserves streaming HTTP while refusing redirects before Chrome sees them. */
export async function browserProxy(allowed:(url:string)=>boolean,blocked:()=>void){
  const username='gwi-browser',password=randomBytes(32).toString('hex');
  const expected=Buffer.from('Basic '+Buffer.from(username+':'+password).toString('base64'));
  const sockets=new Set<Socket>(),outbound=new Set<ReturnType<typeof httpRequest>>();let closed=false;
  const server=createServer((incoming,response)=>{
    const authorization=Buffer.from(incoming.headers['proxy-authorization']??'');
    if(authorization.length!==expected.length||!timingSafeEqual(authorization,expected)){response.writeHead(407,{'proxy-authenticate':'Basic realm="gwi-browser"'});response.end();return;}
    const deny=()=>{blocked();response.writeHead(403,{'content-type':'text/plain','x-gwi-browser-denied':'1'});response.end('This request is outside the authorized browser session.');};
    if(closed||!incoming.url||!allowed(incoming.url)){deny();return;}
    const url=new URL(incoming.url),headers:OutgoingHttpHeaders={...incoming.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
    const request=httpRequest(url,{method:incoming.method,headers,timeout:15000},upstream=>{
      if(upstream.statusCode&&upstream.statusCode>=300&&upstream.statusCode<400&&upstream.headers.location||upstream.headers['content-disposition']?.toLowerCase().includes('attachment')){upstream.destroy();deny();return;}
      response.writeHead(upstream.statusCode??502,upstream.headers);upstream.pipe(response);
      upstream.on('error',()=>response.destroy());
    });
    outbound.add(request);request.once('close',()=>outbound.delete(request));
    request.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    request.on('timeout',()=>request.destroy());incoming.on('aborted',()=>request.destroy());response.on('close',()=>request.destroy());
    let bytes=0;incoming.on('data',chunk=>{bytes+=chunk.length;if(bytes>32*1024*1024){request.destroy();response.destroy();}});incoming.pipe(request);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on('connect',(_request,socket)=>{blocked();socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
  server.on('upgrade',(_request,socket)=>{blocked();socket.destroy();});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('The private browser proxy did not acquire a loopback port.');
  return{server:'http://127.0.0.1:'+address.port,username,password,bypass:'<-loopback>',close:async()=>{
    if(closed)return;closed=true;for(const request of outbound)request.destroy();for(const socket of sockets)socket.destroy();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }};
}
