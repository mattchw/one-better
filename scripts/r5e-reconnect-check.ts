import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {connectDatabase} from '../src/db/connect';

// Read-only verification of the user's final real-account reconnect.
// The local baseline contains registration metadata, never provider credentials.
const baseline=JSON.parse(await readFile('/tmp/r5e-reconnect-baseline.json','utf8'));
const env=parse(await readFile('.env.local'));
const database=connectDatabase(env.DATABASE_URL);
try {
 const connection=(await database.pool.query(
  'SELECT id,client_id,subject,selected_model,status,active,use_for_coaching,scopes,models,catalog_at,version,encrypted_credentials IS NOT NULL AS credentials_present FROM chatgpt_connection WHERE id=$1',
  [baseline.id]
 )).rows[0];
 assert.ok(connection);
 if(connection.status!=='connected'||!connection.use_for_coaching||!connection.catalog_at){
  console.log(JSON.stringify({pending:true,status:connection.status,catalogAvailable:!!connection.catalog_at,explicitUsageEnabled:connection.use_for_coaching}));
 }else {
  assert.equal(connection.client_id,baseline.clientId);
  assert.equal(connection.subject,baseline.subject);
  assert.equal(connection.selected_model,baseline.model);
  assert.equal(connection.active,true);
  assert.equal(connection.credentials_present,true);
  assert.ok(connection.version>baseline.version);
  assert.ok(connection.scopes.includes('chatgpt.tokens.use.direct'));
  assert.ok(connection.models.some((model:{slug:string})=>model.slug===baseline.model));
  assert.equal(await readFile('.one-better/chatgpt-host.json','utf8'),baseline.host);
  const result={realProvider:true,status:'connected',sameOwnedRegistration:true,sameIssuedClientId:true,sameValidatedSubject:true,sameHostId:true,modelRetained:connection.selected_model,planUsageGranted:true,catalogRefreshed:true,protectedCredentialsPresent:true,explicitUsageEnabled:true};
  await writeFile('docs/r5e-evidence/real-reconnect.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }
}finally {
 await database.pool.end();
}
