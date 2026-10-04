import {and,eq,desc} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/node-postgres';
import type {Pool} from 'pg';
import type {Database} from '../../db/connect';
import * as schema from '../../db/schema';
import {chatGPTConnection as table,chatGPTOAuthFlow as flow} from '../../db/schema';
import {ApplicationError} from '../../domain/errors';
export type StoredConnection=typeof table.$inferSelect;
export type StoredAttempt=typeof flow.$inferSelect;
export interface ChatGPTStore {list():Promise<StoredConnection[]>;get(id:string):Promise<StoredConnection|null>;save(c:StoredConnection,activate?:boolean):Promise<void>;attempt():Promise<StoredAttempt|null>;saveAttempt(f:StoredAttempt):Promise<void>;cancelAttempt():Promise<void>}
export interface ChatGPTRepository {read<T>(owner:string,work:(s:ChatGPTStore)=>Promise<T>):Promise<T>;locked<T>(owner:string,work:(s:ChatGPTStore)=>Promise<T>):Promise<T>}
function store(db:Omit<Database,'$client'>,owner:string):ChatGPTStore{
 const owned=eq(table.ownerId,owner);
 return {
 async list(){return db.select().from(table).where(owned).orderBy(desc(table.updatedAt));},
 async get(id){return (await db.select().from(table).where(and(owned,eq(table.id,id))))[0]??null;},
 async save(c,activate=false){if(c.ownerId!==owner)throw new ApplicationError('NOT_FOUND','This ChatGPT connection is unavailable.');await db.transaction(async tx=>{if(activate)await tx.update(table).set({active:false,useForCoaching:false}).where(owned);await tx.insert(table).values(c).onConflictDoUpdate({target:table.id,set:c});});},
 async attempt(){return (await db.select().from(flow).where(eq(flow.ownerId,owner)))[0]??null;},
 async saveAttempt(f){if(f.ownerId!==owner)throw new ApplicationError('NOT_FOUND','This ChatGPT connection is unavailable.');await db.insert(flow).values(f).onConflictDoUpdate({target:flow.ownerId,set:f});},
 async cancelAttempt(){await db.delete(flow).where(eq(flow.ownerId,owner));}
 };
}
async function operation<T>(f:()=>Promise<T>){try{return await f();}catch(e){if(e instanceof ApplicationError||e instanceof Error&&e.name==='ChatGPTFailure')throw e; // Provider failures must not become database errors.
 if(e instanceof Error&&'kind' in e)throw e;throw new ApplicationError('DATABASE_UNAVAILABLE','ChatGPT connection data is unavailable. Please retry.');}}
export function chatGPTRepository(db:Database,pool:Pool):ChatGPTRepository{return {
 read:(owner,work)=>operation(()=>work(store(db,owner))),
 locked:(owner,work)=>operation(async()=>{const client=await pool.connect();let held=false,broken=false;try{await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`chatgpt:${owner}`]);held=true;return await work(store(drizzle(client,{schema}),owner));}finally{if(held)try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`chatgpt:${owner}`]);}catch{broken=true;}client.release(broken);}})
};}
