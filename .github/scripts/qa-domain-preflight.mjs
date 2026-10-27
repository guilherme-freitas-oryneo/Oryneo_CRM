// Verificação HTTP real somente por preflight OPTIONS: nunca envia dados,
// nunca inicia pagamento nem e-mail e não requer token.
const host='https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/';
const origins=['https://crm.oryneo.com.br','https://guilherme-freitas-oryneo.github.io'];
const functions=[
 'proposal-create','proposal-public','mail-api',
 'billing-create-order','billing-public','billing-center',
 'checkout-intake','checkout-intake-noncard-test',
 'company-enrich','delivery-admin','delivery-public',
 'landing-admin','landing-public','offboarding-admin','offboarding-public',
];
let failures=0,checked=0;
for(const slug of functions){
 for(const origin of origins){
  let status='ERR',allowed='';
  try{
   const response=await fetch(host+slug,{
    method:'OPTIONS',
    headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'},
    signal:AbortSignal.timeout(15000),
  });
   status=response.status;
   allowed=response.headers.get('access-control-allow-origin')||'';
   checked++;
   if(status!==204||allowed!==origin)failures++;
  }catch(error){
   failures++;
   status=error instanceof Error?error.name:'FetchError';
  }
  console.log([slug,origin,status,allowed===origin?'CORS_OK':`CORS_FAIL allow=${allowed||'(absent)'}`].join(' | '));
 }
}
console.log(`Domain preflight checks: ${checked}, failures: ${failures}`);
if(checked!==functions.length*origins.length||failures>0)process.exitCode=1;

// Prova read-only das páginas estáticas após o hotfix de GitHub Pages.
// NÃO visita URLs com token, não acessa contas e nunca inicia cobranças.
const publicRoutes=['/','/contratar/','/pagar/','/proposta/','/implantacao/','/revisao-lp/','/encerramento/','/Oryneo_CRM/pagar/','/Oryneo_CRM/proposta/'];
let pageFailures=0;
for(const path of publicRoutes){
 try{
  const response=await fetch('https://crm.oryneo.com.br'+path,{redirect:'follow',signal:AbortSignal.timeout(15000)});
  const html=await response.text();
  const valid=response.status===200&&html.includes('/assets/')&&!html.includes('/Oryneo_CRM/assets/');
  if(!valid)pageFailures++;
  console.log(`pages ${path} | ${response.status} | ${valid?'ROOT_ASSETS_OK':'FAILED'}`);
 }catch(error){
  pageFailures++;
  console.log(`pages ${path} | ${error instanceof Error?error.name:'network-error'} | FAILED`);
 }
}
console.log(`Static routes: ${publicRoutes.length}, failures: ${pageFailures}`);
if(pageFailures)process.exitCode=1;
