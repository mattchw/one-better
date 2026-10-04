import {requireActor} from '@/server/actor';
import {chatGPT,chatGPTConfiguration} from '@/server/chatgpt';
import {readConfiguration} from '@/server/config';
export async function GET(request:Request){
 const origin=new URL(readConfiguration(process.env).BETTER_AUTH_URL).origin;let result='failed';
 // Never log/query-render the authorization code, state or provider payload.
 try{const actor=await requireActor(request.headers),u=new URL(request.url),config=chatGPTConfiguration();if(config&&request.headers.get('host')===new URL(config.redirectUri).host&&u.searchParams.getAll('state').length===1&&['code','client_id','error'].every(k=>u.searchParams.getAll(k).length<=1))result=await chatGPT().callback(actor,{state:u.searchParams.get('state'),code:u.searchParams.get('code'),clientId:u.searchParams.get('client_id'),denied:u.searchParams.has('error')});}catch{/* Clean failure redirect; no credential-bearing diagnostics. */}
 return new Response(null,{status:303,headers:{Location:`${origin}/integrations?chatgpt=${result}`,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
}
