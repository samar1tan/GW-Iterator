#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),command=args.shift()??'help';
if(command==='help'){console.log('gwi status\ngwi projects\ngwi request METHOD /api/path [--file private-input.json]\nReads its token from GWI_DATA_DIR/token (default: the local .local/state directory). GWI_URL overrides the loopback endpoint.');process.exit(0);}
const method=command==='request'?(args.shift()??'GET').toUpperCase():'GET';
const route=command==='request'?args.shift():command==='projects'||command==='status'?'/api/overview':null;
if(!route?.startsWith('/api/'))throw new Error('Use a supported command and /api/ route.');
const token=(await readFile(path.join(process.env.GWI_DATA_DIR??path.join(root,'.local/state'),'token'),'utf8')).trim();
let body;
if(method!=='GET'){const option=args.indexOf('--file');if(option>=0)body=await readFile(args[option+1],'utf8');else if(!process.stdin.isTTY){const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);body=Buffer.concat(chunks).toString('utf8')||'{}';}else body='{}';JSON.parse(body);}
const endpoint=new URL(process.env.GWI_URL??'http://127.0.0.1:4318');
if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new Error('The control CLI accepts a loopback endpoint only.');
const response=await fetch(new URL(route,endpoint),{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-gwi-actor':'local-cli'},body});
const value=await response.json();console.log(JSON.stringify(value,null,2));if(!response.ok)process.exitCode=1;
