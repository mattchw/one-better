import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {connectDatabase} from '../src/db/connect';
import {credentialCipher} from '../src/modules/calendar/encryption';
import {chatGPTRepository} from '../src/modules/chatgpt/repository';
import {chatGPTService} from '../src/modules/chatgpt/service';
import {chatGPTOAuth} from '../src/providers/chatgpt/oauth';
import {hostId} from '../src/modules/chatgpt/host';
import {canonical} from '../src/modules/coaching/context';
const env=parse(await readFile('.env.local')),db=connectDatabase(env.DATABASE_URL);try{const r=(await db.pool.query("SELECT id,owner_id FROM chatgpt_connection WHERE active AND use_for_coaching AND status='connected'")).rows;assert.equal(r.length,1);const actor={userId:r[0].owner_id},service=chatGPTService({repository:chatGPTRepository(db.db,db.pool),cipher:credentialCipher(JSON.parse(env.CHATGPT_ENCRYPTION_KEYS??env.CALENDAR_ENCRYPTION_KEYS),env.CHATGPT_ENCRYPTION_KEY_ID??env.CALENDAR_ENCRYPTION_KEY_ID),oauth:chatGPTOAuth(),host:()=>hostId('.one-better/chatgpt-host.json'),redirectUri:`${env.BETTER_AUTH_URL}/auth/chatgpt/callback`});const c=(await service.workspace(actor)).connections.find(c=>c.id===r[0].id)!;
 async function coreHash(){const rows:Record<string,unknown>={};for(const t of ['goal','milestone','action','weekly_plan','weekly_commitment','weekly_plan_amendment','amendment_commitment','time_block','focus_session','daily_reflection','weekly_review','weekly_review_decision','focus_cycle','focus_cycle_goal','focusable_hours'])rows[t]=(await db.pool.query(`SELECT row_to_json(t) FROM ${t} t WHERE owner_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;for(const t of ['auth_account','auth_session'])rows[t]=(await db.pool.query(`SELECT row_to_json(t) FROM ${t} t WHERE user_id=$1 ORDER BY row_to_json(t)::text`,[actor.userId])).rows;return createHash('sha256').update(canonical(rows)).digest('hex');}
 const before=await coreHash(),host=await readFile('.one-better/chatgpt-host.json','utf8'),disconnected=await service.disconnect(actor,c.id,{expectedVersion:c.version});assert.equal(await coreHash(),before);assert.equal((await db.pool.query('SELECT encrypted_credentials FROM chatgpt_connection WHERE id=$1',[c.id])).rows[0].encrypted_credentials,null);
 await writeFile('/tmp/r5e-reconnect-baseline.json',JSON.stringify({id:c.id,clientId:c.clientId,subject:c.subject,model:c.selectedModel,host,version:disconnected.version}),{mode:0o600});await writeFile('docs/r5e-evidence/real-disconnect.json',JSON.stringify({realProvider:true,localStatus:disconnected.status,protectedCredentialsRemoved:true,modelRetained:c.selectedModel,remoteRevocationConfirmed:disconnected.revocationConfirmed,corePlanningAndBetterAuthRowsByteUnchanged:true,source:'same owned disconnect service as the UI endpoint'},null,2));console.log(JSON.stringify({localStatus:disconnected.status,remoteRevocationConfirmed:disconnected.revocationConfirmed,coreAndLoginUnchanged:true}));
}finally{await db.pool.end();}
