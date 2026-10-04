export function readAIConfiguration(env:Record<string,string|undefined>) {
  const name=env.AI_PROVIDER;
  if(!name)return {state:'disabled' as const,provider:null};
  if(name!=='openai'&&name!=='anthropic')return {state:'incomplete' as const,provider:null};
  const key=env[name==='openai'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY']?.trim(),model=env[name==='openai'?'OPENAI_MODEL':'ANTHROPIC_MODEL']?.trim();
  if(!key||!model||model.length>160||!/^[a-zA-Z0-9._:/-]+$/.test(model))return {state:'incomplete' as const,provider:null};
  return {state:'ready' as const,provider:{name,key,model}};
}
export function testAIBaseURL(env:Record<string,string|undefined>):string|undefined {
  if(!env.AI_TEST_BASE_URL)return undefined;
  const loopback=(url:URL)=>['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  try{const database=new URL(env.DATABASE_URL??''),origin=new URL(env.BETTER_AUTH_URL??''),provider=new URL(env.AI_TEST_BASE_URL);
    if(!loopback(database)||!/^\/execution_test_[a-z0-9]+$/.test(database.pathname)||!loopback(origin)||!loopback(provider)||provider.protocol!=='http:'||provider.pathname!=='/'||provider.search||provider.hash||provider.username||provider.password||env.OPENAI_API_KEY!=='one-better-test-key'||env.ANTHROPIC_API_KEY!=='one-better-test-key')throw new Error();
    return provider.toString().replace(/\/$/,'');
  }catch{throw new Error('AI fixture requires an isolated loopback test database, origin and dummy credentials.');}
}
