import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {isAsyncFunction,isPromise} from 'node:util/types';
import path from 'node:path';
import type {AuditEvent} from './contracts.ts';
import {AppError} from './validation.ts';

type ReadView={lists:Map<string,unknown[]>;records:Map<string,Map<string,unknown>>};
function frozenDocument(document:unknown):unknown {
  const value:unknown=JSON.parse(String(document)),pending=[value];
  while(pending.length){const item=pending.pop();if(!item||typeof item!=='object'||Object.isFrozen(item))continue;Object.freeze(item);for(const child of Object.values(item))if(child&&typeof child==='object')pending.push(child);}
  return value;
}

export class Store {
  readonly db: DatabaseSync;
  readonly directory:string;
  private transactionDepth=0;
  private readView:ReadView|null=null;
  constructor(directory: string) {
    this.directory=path.resolve(directory);
    mkdirSync(directory,{recursive:true,mode:0o700});
    const filename=path.join(directory,'iterator.sqlite');
    this.db=new DatabaseSync(filename); chmodSync(filename,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,project_id TEXT,run_id TEXT,stage_id TEXT,type TEXT NOT NULL,actor TEXT NOT NULL,message TEXT NOT NULL,data TEXT);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO metadata VALUES('schema','1');`);
    if(this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value!=='1')throw new Error('UNSUPPORTED_STORE_SCHEMA');
  }
  /** One synchronous observation. Cached rows are immutable; no state survives the callback. */
  withReadView<T>(operation:()=>T):T {
    if(isAsyncFunction(operation))throw new AppError('READ_VIEW_ASYNC','A read view callback must be synchronous.',500);
    const previous=this.readView,ownTransaction=!previous&&this.transactionDepth===0;
    if(!previous){if(ownTransaction)this.db.exec('BEGIN DEFERRED');this.readView={lists:new Map(),records:new Map()};}
    try{
      const result=operation();
      if(result&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function'){
        // Rejection cannot cancel a promise already started by a non-async callback.
        if(isPromise(result))void result.catch(()=>undefined);
        throw new AppError('READ_VIEW_ASYNC','A read view callback must not return a promise or thenable.',500);
      }
      if(ownTransaction)this.db.exec('COMMIT');return result;
    }catch(error){if(ownTransaction)this.db.exec('ROLLBACK');throw error;}
    finally{this.readView=previous;}
  }
  private writable():void {if(this.readView)throw new AppError('READ_VIEW_WRITE','Writes are not allowed during a read view.',500);}
  get<T>(kind:string,id:string):T|null {
    const cached=this.readView?.records.get(kind);
    if(cached?.has(id))return cached.get(id) as T|null;
    if(this.readView?.lists.has(kind))return null;
    const row=this.db.prepare('SELECT document FROM records WHERE kind=? AND id=?').get(kind,id);
    const value=row?(this.readView?frozenDocument(row.document):JSON.parse(String(row.document))):null;
    if(this.readView){const records=cached??new Map<string,unknown>();records.set(id,value);this.readView.records.set(kind,records);}return value as T|null;
  }
  list<T>(kind:string):T[] {
    const existing=this.readView?.lists.get(kind);if(existing)return existing.slice() as T[];
    const records=this.readView?.records.get(kind)??new Map<string,unknown>();
    const values=this.db.prepare('SELECT id,document FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row=>{const id=String(row.id);if(this.readView&&records.has(id))return records.get(id);const value=this.readView?frozenDocument(row.document):JSON.parse(String(row.document));if(this.readView)records.set(id,value);return value;});
    if(this.readView){this.readView.records.set(kind,records);this.readView.lists.set(kind,values);}return values.slice() as T[];
  }
  put<T extends {id:string}>(kind:string,value:T):void {this.writable();this.db.prepare('INSERT INTO records(kind,id,document) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document').run(kind,value.id,JSON.stringify(value));}
  delete(kind:string,id:string):void {this.writable();this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
  transaction<T>(operation:()=>T):T {
    this.writable();
    const depth=this.transactionDepth++,marker=`nested_${depth}`;
    this.db.exec(depth?`SAVEPOINT ${marker}`:'BEGIN IMMEDIATE');
    try{const result=operation();this.db.exec(depth?`RELEASE SAVEPOINT ${marker}`:'COMMIT');return result;}
    catch(error){this.db.exec(depth?`ROLLBACK TO SAVEPOINT ${marker}`:'ROLLBACK');if(depth)this.db.exec(`RELEASE SAVEPOINT ${marker}`);throw error;}
    finally{this.transactionDepth--;}
  }
  event(input:Omit<AuditEvent,'seq'|'at'>):AuditEvent {
    this.writable();
    const at=new Date().toISOString();
    const result=this.db.prepare('INSERT INTO events(at,project_id,run_id,stage_id,type,actor,message,data) VALUES(?,?,?,?,?,?,?,?)').run(at,input.projectId,input.runId,input.stageId,input.type,input.actor,input.message,input.data===undefined?null:JSON.stringify(input.data));
    return {...input,seq:Number(result.lastInsertRowid),at};
  }
  events(options:{projectId?:string;runId?:string;after?:number;limit?:number}={}):AuditEvent[] {
    const rows=this.db.prepare('SELECT * FROM events WHERE seq>? AND (? IS NULL OR project_id=?) AND (? IS NULL OR run_id=?) ORDER BY seq DESC LIMIT ?').all(options.after??0,options.projectId??null,options.projectId??null,options.runId??null,options.runId??null,options.limit??200);
    return rows.reverse().map(row=>({seq:Number(row.seq),at:String(row.at),projectId:row.project_id===null?null:String(row.project_id),runId:row.run_id===null?null:String(row.run_id),stageId:row.stage_id===null?null:String(row.stage_id),type:String(row.type),actor:String(row.actor),message:String(row.message),...(row.data?{data:JSON.parse(String(row.data))}: {})}));
  }
  close():void{this.writable();this.db.close();}
}
