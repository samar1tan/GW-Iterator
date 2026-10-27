import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import path from 'node:path';
import type {AuditEvent} from './contracts.ts';

export class Store {
  readonly db: DatabaseSync;
  private transactionDepth=0;
  constructor(directory: string) {
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
  get<T>(kind:string,id:string):T|null {
    const row=this.db.prepare('SELECT document FROM records WHERE kind=? AND id=?').get(kind,id);
    return row?JSON.parse(String(row.document)) as T:null;
  }
  list<T>(kind:string):T[] {return this.db.prepare('SELECT document FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row=>JSON.parse(String(row.document)) as T);}
  put<T extends {id:string}>(kind:string,value:T):void {this.db.prepare('INSERT INTO records(kind,id,document) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document').run(kind,value.id,JSON.stringify(value));}
  delete(kind:string,id:string):void {this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
  transaction<T>(operation:()=>T):T {
    const depth=this.transactionDepth++,marker=`nested_${depth}`;
    this.db.exec(depth?`SAVEPOINT ${marker}`:'BEGIN IMMEDIATE');
    try{const result=operation();this.db.exec(depth?`RELEASE SAVEPOINT ${marker}`:'COMMIT');return result;}
    catch(error){this.db.exec(depth?`ROLLBACK TO SAVEPOINT ${marker}`:'ROLLBACK');if(depth)this.db.exec(`RELEASE SAVEPOINT ${marker}`);throw error;}
    finally{this.transactionDepth--;}
  }
  event(input:Omit<AuditEvent,'seq'|'at'>):AuditEvent {
    const at=new Date().toISOString();
    const result=this.db.prepare('INSERT INTO events(at,project_id,run_id,stage_id,type,actor,message,data) VALUES(?,?,?,?,?,?,?,?)').run(at,input.projectId,input.runId,input.stageId,input.type,input.actor,input.message,input.data===undefined?null:JSON.stringify(input.data));
    return {...input,seq:Number(result.lastInsertRowid),at};
  }
  events(options:{projectId?:string;runId?:string;after?:number;limit?:number}={}):AuditEvent[] {
    const rows=this.db.prepare('SELECT * FROM events WHERE seq>? AND (? IS NULL OR project_id=?) AND (? IS NULL OR run_id=?) ORDER BY seq DESC LIMIT ?').all(options.after??0,options.projectId??null,options.projectId??null,options.runId??null,options.runId??null,options.limit??200);
    return rows.reverse().map(row=>({seq:Number(row.seq),at:String(row.at),projectId:row.project_id===null?null:String(row.project_id),runId:row.run_id===null?null:String(row.run_id),stageId:row.stage_id===null?null:String(row.stage_id),type:String(row.type),actor:String(row.actor),message:String(row.message),...(row.data?{data:JSON.parse(String(row.data))}: {})}));
  }
  close():void{this.db.close();}
}
