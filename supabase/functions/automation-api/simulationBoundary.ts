/**
 * Simulation-only hypothetical context. It is NEVER canonical business proof,
 * a provider receipt, consent token or permission to dispatch.
 */
type Dict=Record<string,unknown>;
const isObject=(v:unknown):v is Dict=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeString=(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=128
  &&!/[^\x20-\x7E\u00A0-\u024F]/.test(v);
const allowed:Record<string,Record<string,'string'|'boolean'>>={
  opportunity:{intent:'string',stage_id:'string',source:'string',plan:'string',cycle:'string'},
  conversation:{mode:'string',opted_out:'boolean',consent_granted:'boolean'},
  billing:{status:'string',paid_verified:'boolean'},
  lead:{intent:'string'},
};
export type SimulationFixture={event:{type:string}}&Dict;
export function parseSimulationFixture(
 raw:unknown,eventType:unknown,approvedEvents:readonly string[],
):{ok:true;fixture:SimulationFixture}|{ok:false;code:string}{
 if(typeof eventType!=='string'||!approvedEvents.includes(eventType))
  return {ok:false,code:'SIMULATION_EVENT_UNSUPPORTED'};
 if(raw!==undefined&&!isObject(raw))
  return {ok:false,code:'SIMULATION_CONTEXT_INVALID'};
 const values:Dict={};
 const source=(raw??{}) as Dict;
 if(Object.keys(source).length>4)
  return {ok:false,code:'SIMULATION_CONTEXT_TOO_LARGE'};
 for(const [section,data] of Object.entries(source)){
   if(!Object.hasOwn(allowed,section)||!isObject(data))
     return {ok:false,code:'SIMULATION_FIELD_NOT_ALLOWED'};
   const safe:Dict={};
   for(const [key,value] of Object.entries(data)){
     const expected=allowed[section][key];
     if(!expected||(expected==='boolean'&&typeof value!=='boolean')
       ||(expected==='string'&&!safeString(value)))
       return {ok:false,code:'SIMULATION_VALUE_INVALID'};
     safe[key]=value;
   }
   values[section]=safe;
 }
 // A user cannot spoof the canonical event source or override an event ID.
 // Only the server-generated event.type is installed into the sandbox.
 return {ok:true,fixture:{...values,event:{type:eventType}}};
}
