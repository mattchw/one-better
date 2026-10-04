import 'server-only';
import {resolve} from 'node:path';
import {credentialCipher} from '../modules/calendar/encryption';
import {chatGPTRepository} from '../modules/chatgpt/repository';
import {chatGPTService} from '../modules/chatgpt/service';
import {chatGPTOAuth} from '../providers/chatgpt/oauth';
import {hostId} from '../modules/chatgpt/host';
import {ApplicationError} from '../domain/errors';
import {readConfiguration} from './config';
import {runtime} from './runtime';
export function chatGPTConfiguration(env=process.env){
 const app=new URL(readConfiguration(env).BETTER_AUTH_URL);
 if(app.protocol!=='http:'||app.hostname!=='127.0.0.1')return null;
 const keys=env.CHATGPT_ENCRYPTION_KEYS??env.CALENDAR_ENCRYPTION_KEYS,keyId=env.CHATGPT_ENCRYPTION_KEY_ID??env.CALENDAR_ENCRYPTION_KEY_ID;if(!keys||!keyId)return null;
 try{let testOrigin:string|undefined;if(env.CHATGPT_TEST_ORIGIN){const t=new URL(env.CHATGPT_TEST_ORIGIN),database=new URL(env.DATABASE_URL!);if(t.protocol!=='http:'||t.hostname!=='127.0.0.1'||t.pathname!=='/'||t.search||t.hash||t.username||t.password||!['127.0.0.1','localhost','[::1]'].includes(database.hostname)||!/^\/execution_test_[a-z0-9]+$/.test(database.pathname)||env.CHATGPT_TEST_MODE!=='isolated-fixture')throw new Error();testOrigin=t.origin;}
 return {cipher:credentialCipher(JSON.parse(keys),keyId),redirectUri:`${app.origin}/auth/chatgpt/callback`,testOrigin,hostFile:resolve(env.CHATGPT_HOST_FILE??'.one-better/chatgpt-host.json')};}
 catch{throw new ApplicationError('CONFLICT','ChatGPT connection configuration needs attention.');}
}
export function chatGPT(){const c=chatGPTConfiguration();if(!c)throw new ApplicationError('CONFLICT','ChatGPT connections require a local 127.0.0.1 app and server credential encryption.');const {db,pool}=runtime();return chatGPTService({repository:chatGPTRepository(db,pool),cipher:c.cipher,oauth:chatGPTOAuth({testOrigin:c.testOrigin}),host:()=>hostId(c.hostFile),redirectUri:c.redirectUri});}
