/**
 * Validates immutable Meta template components against the exact registry ID.
 * This validates component shape ONLY. It NEVER authorizes sending;
 * Meta approval must be rechecked immediately before every live delivery.
 */
type Dict=Record<string,unknown>;
const obj=(v:unknown):v is Dict=>!!v&&typeof v==='object'&&!Array.isArray(v);
const s=(v:unknown):v is string=>typeof v==='string';
export type MetaTemplateSnapshot={
  ok:boolean;issues:string[];
  schema:{
    source:'Meta Cloud API';snapshot_only:true;send_guard:'backend_required';
    components_verified:boolean;variable_numbers:string[];meta_components:unknown[];
  };
};
const extract=(raw:unknown):{ids:string[];bad:boolean}=>{
 if(!s(raw))return {ids:[],bad:true};
 const rawMatches=[...raw.matchAll(/\{\{([^{}]+)\}\}/g)].map(m=>m[1]);
 const numbers=[...new Set(rawMatches)].sort((a,b)=>Number(a)-Number(b));
 return {ids:numbers,bad:rawMatches.some(x=>!/^[1-9][0-9]?$/.test(x))||
    numbers.some((x,i)=>x!==String(i+1))};
};
export function verifyMetaTemplateComponents(
 raw:unknown,registry:{
   template_name:string;provider_template_id:string;language:string;category:string;
 }):MetaTemplateSnapshot{
 const issues:string[]=[];
 const fail=(s:string)=>{if(!issues.includes(s))issues.push(s)};
 const comps:unknown[]=[];
 let vars:string[]=[];
 if(!obj(raw)){fail('META_PAYLOAD_INVALID');}
 else{
   if(raw.id!==registry.provider_template_id||raw.name!==registry.template_name
      ||raw.language!==registry.language||raw.category!==registry.category)
     fail('TEMPLATE_IDENTITY_MISMATCH');
   if(raw.status!=='APPROVED')fail('TEMPLATE_NOT_APPROVED');
   if(raw.parameter_format!=='POSITIONAL')fail('PARAMETER_FORMAT_UNSUPPORTED');
   if(!Array.isArray(raw.components)||raw.components.length>6)
     fail('COMPONENTS_INVALID');
   else{
     comps.push(...raw.components);
     const bodies=raw.components.filter((x:unknown)=>obj(x)&&x.type==='BODY');
     if(bodies.length!==1)fail('BODY_REQUIRED');
     if(raw.components.some((x:unknown)=>!obj(x)||!['BODY','HEADER','FOOTER'].includes(String(x.type))))
       fail('COMPONENT_UNSUPPORTED');
     const body=bodies[0];
     if(obj(body)){
       if(!s(body.text)||!body.text.trim()||body.text.length>1024)
         fail('BODY_TEXT_INVALID');
       const match=extract(body.text);
       vars=match.ids;
       if(match.bad)fail('BODY_PLACEHOLDERS_INVALID');
       if(vars.length){
         const samples=obj(body.example)?body.example.body_text:null;
         if(!Array.isArray(samples)||samples.length!==1||
           !Array.isArray(samples[0])||samples[0].length!==vars.length||
           !samples[0].every((x:unknown)=>s(x)&&x.trim()))
           fail('BODY_EXAMPLE_MISMATCH');
       }
     }
     for(const header of raw.components.filter((x:unknown)=>obj(x)&&x.type==='HEADER')){
       if(!obj(header)||header.format!=='TEXT'||!s(header.text)||
          extract(header.text).ids.length!==0)
         fail('HEADER_VARIABLE_UNSUPPORTED');
     }
     for(const footer of raw.components.filter((x:unknown)=>obj(x)&&x.type==='FOOTER')){
       if(!obj(footer)||!s(footer.text)||footer.text.length>60)
         fail('FOOTER_INVALID');
     }
   }
 }
 return {ok:issues.length===0,issues,schema:{
   source:'Meta Cloud API',snapshot_only:true,send_guard:'backend_required',
   components_verified:issues.length===0,variable_numbers:vars,
   meta_components:issues.length===0?comps:[],
 }};
}
