import { CoachingFailure } from '../modules/coaching/domain';
export function safeProviderFailure(error:unknown):CoachingFailure {
  if(error instanceof CoachingFailure)return error;
  const value=error as {status?:number;name?:string;constructor?:{name?:string}};
  // Official SDK Error subclasses retain name="Error"; inspect class identity,
  // never a message or secret-bearing error payload, for timeout/abort metadata.
  const timeout=[value?.name,value?.constructor?.name].some(name=>name?.includes('Timeout')||name?.includes('Abort'));
  const kind=timeout?'timeout':value?.status===401||value?.status===403?'authentication':value?.status===429?'rate_limit':value?.status===404?'model_unavailable':'unavailable';
  return new CoachingFailure(kind);
}
