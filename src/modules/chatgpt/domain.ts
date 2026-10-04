import {z} from 'zod';
export const scopes=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'];
export const resource='https://api.openai.com/v1';
export type Credentials={accessToken:string;refreshToken:string|null;idToken:string|null;expiresAt:string};
export type Model={slug:string;displayName:string};
export type Identity={subject:string;email:string|null;name:string|null};
export type Connection={id:string;subject:string|null;email:string|null;name:string|null;clientId:string;scopes:string[];status:'pending'|'connected'|'needs_sign_in'|'disconnected';active:boolean;useForCoaching:boolean;selectedModel:string|null;models:Model[];catalogAt:string|null;version:number;createdAt:string;updatedAt:string;revocationConfirmed:boolean|null};
export type ChatGPTWorkspace={configured:boolean;connections:Connection[]};
export const startSchema=z.strictObject({connectionId:z.uuid().nullable()});
export const updateSchema=z.strictObject({expectedVersion:z.number().int().positive(),selectedModel:z.string().min(1).max(160).optional(),useForCoaching:z.boolean().optional()}).refine(v=>v.selectedModel!==undefined||v.useForCoaching!==undefined);
export const versionSchema=z.strictObject({expectedVersion:z.number().int().positive()});
export class ChatGPTFailure extends Error {constructor(public readonly kind:'temporary'|'terminal_refresh'|'authentication'|'invalid_identity'|'invalid_response'|'rate_limit'){super('ChatGPT connection could not complete.');}}
export const planGranted=(s:string[])=>s.includes('chatgpt.tokens.use.direct')&&s.includes('resource.invoke');
