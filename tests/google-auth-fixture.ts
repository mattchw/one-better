import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { AddressInfo } from 'node:net';
export type GoogleIdentity = { email: string; subject: string; verified: boolean };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function startGoogleAuthFixture(baseURL: string) {
  const keys = await generateKeyPair('RS256'), jwk = await exportJWK(keys.publicKey); Object.assign(jwk, {kid:'google-fixture',alg:'RS256',use:'sig'});
  let origin = '', identity: GoogleIdentity = {email:'unknown@example.test',subject:'google-unknown',verified:true}, mode = 'normal', exchanges = 0;
  const requests = new Map<string,{query:URLSearchParams;identity:GoogleIdentity;mode:string}>(), codes = new Map<string,{query:URLSearchParams;identity:GoogleIdentity;mode:string}>();
  let lastAuthorization: {scopes:string[];redirectURI:string;clientId:string;includeGrantedScopes:string|null;accessType:string|null}|null = null;
  async function token(profile:GoogleIdentity,audience='google-auth-fixture') {
    return new SignJWT({email:profile.email,email_verified:profile.verified,name:'Google Fixture',picture:'https://example.test/avatar.png'}).setProtectedHeader({alg:'RS256',kid:'google-fixture'}).setIssuer('https://accounts.google.com').setSubject(profile.subject).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  }
  const server = createServer(async(req,res)=>{try {
    let raw='';for await(const chunk of req)raw+=chunk;
    const url = new URL(req.url!,origin), json=(data:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/control') {if(req.method==='POST'){const body=JSON.parse(raw);identity={...identity,...body.identity};mode=body.mode??'normal';}return json({identity,mode,exchanges,lastAuthorization});}
    if(url.pathname==='/certs') return json({keys:[jwk]});
    if(url.pathname==='/identity-token') return json({idToken:await token(identity)});
    if(url.pathname==='/authorize') {
      const q=url.searchParams,redirectURI=q.get('redirect_uri')!;
      if(redirectURI!==`${baseURL}/api/auth/callback/google`||q.get('client_id')!=='google-auth-fixture'||q.get('code_challenge_method')!=='S256'||!q.get('state')||!q.get('code_challenge'))return json({error:'invalid_request'},400);
      lastAuthorization={scopes:(q.get('scope')??'').split(' ').sort(),redirectURI,clientId:q.get('client_id')!,includeGrantedScopes:q.get('include_granted_scopes'),accessType:q.get('access_type')};
      const id=randomUUID();requests.set(id,{query:q,identity:{...identity},mode});
      res.writeHead(200,{'Content-Type':'text/html'});return res.end(`<!doctype html><html><head><title>Fake Google sign-in</title></head><body><h1>Test Google sign-in</h1><p>${escape(identity.email)}</p><p>Identity permissions only: ${escape(q.get('scope')??'')}</p><a href="${origin}/approve?id=${id}">Continue with test Google identity</a><p><a href="${origin}/cancel?id=${id}">Cancel Google sign-in</a></p></body></html>`);
    }
    if(url.pathname==='/approve'||url.pathname==='/cancel') {
      const request=requests.get(url.searchParams.get('id')!);requests.delete(url.searchParams.get('id')!);if(!request)return json({},400);
      const callback=new URL(request.query.get('redirect_uri')!);callback.searchParams.set('state',request.query.get('state')!);
      if(url.pathname==='/cancel'){callback.searchParams.set('error','access_denied');callback.searchParams.set('error_description','PRIVATE_PROVIDER_INTERNAL');}
      else {const code=randomUUID();codes.set(code,request);callback.searchParams.set('code',code);}
      res.writeHead(302,{Location:callback.toString()});return res.end();
    }
    if(url.pathname==='/token') {
      exchanges++;const form=new URLSearchParams(raw),value=codes.get(form.get('code')!);codes.delete(form.get('code')!);
      if(!value||form.get('client_id')!=='google-auth-fixture'||form.get('client_secret')!=='google-auth-fixture-secret'||form.get('redirect_uri')!==value.query.get('redirect_uri')||createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==value.query.get('code_challenge'))return json({error:'invalid_grant'},400);
      if(value.mode==='failure')return json({error:'PRIVATE_PROVIDER_INTERNAL'},503);
      return json({access_token:'google-access-fixture-secret',refresh_token:'google-refresh-fixture-secret',id_token:await token(value.identity),token_type:'Bearer',expires_in:3600,scope:value.query.get('scope')});
    }
    return json({},404);
  } catch {res.writeHead(500);res.end('{}');}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {origin,token,environment:{GOOGLE_AUTH_TEST_ORIGIN:origin,GOOGLE_AUTH_CLIENT_ID:'google-auth-fixture',GOOGLE_AUTH_CLIENT_SECRET:'google-auth-fixture-secret'},async control(data:{identity?:Partial<GoogleIdentity>;mode?:string}){await fetch(`${origin}/control`,{method:'POST',body:JSON.stringify(data)});},async authorize(url:string,cancel=false){const actual=new URL('/authorize',origin);actual.search=new URL(url).search;const response=await fetch(actual),html=await response.text(),id=html.match(/approve\?id=([a-f0-9-]+)/)![1];const callback=await fetch(`${origin}/${cancel?'cancel':'approve'}?id=${id}`,{redirect:'manual'});return callback.headers.get('location')!;},stats:async()=> (await fetch(`${origin}/control`)).json(),close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
