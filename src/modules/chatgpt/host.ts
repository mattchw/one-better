import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
export async function hostId(file:string):Promise<string>{
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 try{const h=await open(file,'wx',0o600);try{await h.writeFile(JSON.stringify({hostId:`urn:uuid:${randomUUID()}`}));await h.sync();}finally{await h.close();}}
 catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw new Error('ChatGPT host configuration unavailable.');}
 // Concurrent first launches may see a newly created file before its write ends.
 for(let attempt=0;attempt<10;attempt++){try{const info=await stat(file);if(info.mode&0o077)throw new Error();const data=JSON.parse(await readFile(file,'utf8'));if(!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.hostId))throw new Error();return data.hostId;}catch{if(attempt===9)throw new Error('ChatGPT host configuration unavailable.');await new Promise(r=>setTimeout(r,20));}}
 throw new Error('ChatGPT host configuration unavailable.');
}
