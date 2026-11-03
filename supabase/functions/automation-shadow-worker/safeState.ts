type ErrorLike={code?:unknown;message?:unknown};

const object=(value:unknown):value is ErrorLike=>value!==null&&typeof value==='object';

/**
 * Maps only explicit, non-sensitive runtime stop conditions to a healthy
 * worker result. Permission, schema and provider failures must remain visible.
 */
export function shadowSafeState(error:unknown):{code:string}|null{
  if(!object(error)||typeof error.message!=='string')return null;
  if(error.message==='SHADOW_RUNTIME_DISABLED')return {code:'SHADOW_RUNTIME_DISABLED'};
  return null;
}
