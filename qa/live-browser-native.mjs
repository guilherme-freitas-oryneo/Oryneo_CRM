// Browser smoke for the published ORYNEO CRM using GitHub's preinstalled
// Chrome/ChromeDriver and WebDriver W3C — no npm package downloads.
// Never authenticate, submit a lead, send WhatsApp or create a payment.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';

const endpoint='http://127.0.0.1:9515';
const origin='https://crm.oryneo.com.br/';
const safeError=(e)=>String(e?.message||e).slice(0,400);
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const driver=spawn('chromedriver',['--port=9515'],{stdio:'pipe'});
let driverErrors='';
driver.stderr.on('data',b=>{driverErrors+=b.toString().slice(-1000)});
async function cmd(method,path,payload){
 const response=await fetch(endpoint+path,{
  method,headers:payload?{'content-type':'application/json'}:undefined,
  body:payload?JSON.stringify(payload):undefined,
  signal:AbortSignal.timeout(45000),
 });
 const data=await response.json();
 if(!response.ok||data.value?.error)
  throw Error('WEBDRIVER_'+path+'_'+JSON.stringify(data.value).slice(0,600));
 return data.value;
}
try{
 let ok=false;
 for(let attempt=0;attempt<45;attempt++){
  try{
   const status=await cmd('GET','/status');
   if(status.ready){ok=true;break;}
  }catch{}
  await sleep(350);
 }
 if(!ok)throw Error('CHROMEDRIVER_DID_NOT_START '+driverErrors.slice(-700));
 await mkdir('qa-live-browser',{recursive:true});
 for(const mode of [
  {name:'mobile',width:390,height:844,mobile:true},
  {name:'desktop',width:1440,height:900,mobile:false}
 ]){
  const opts={
   args:['--headless=new','--no-sandbox','--disable-dev-shm-usage',
    '--disable-background-networking','--window-size='+mode.width+','+mode.height],
  };
  if(mode.mobile){
   opts.mobileEmulation={
    deviceMetrics:{width:mode.width,height:mode.height,pixelRatio:1,mobile:true},
   };
  }
  const result=await fetch(endpoint+'/session',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({capabilities:{alwaysMatch:{
    browserName:'chrome','goog:chromeOptions':opts}}}),
   signal:AbortSignal.timeout(35000),
  });
  const created=await result.json();
  const sessionId=created.value?.sessionId||created.sessionId;
  if(!result.ok||!sessionId)
   throw Error('CHROME_SESSION_CREATION_FAILED_'+JSON.stringify(created).slice(0,550));
  const path='/session/'+sessionId;
  try{
   if(!mode.mobile){
    await cmd('POST',path+'/window/rect',{width:mode.width,height:mode.height});
   }
   await cmd('POST',path+'/url',{url:origin});
   let state={};
   for(let attempt=0;attempt<40;attempt++){
    state=await cmd('POST',path+'/execute/sync',{
     script:`const email=document.querySelector('input[name="email"]');
const password=document.querySelector('input[name="password"]');
const visible=el=>el&&el.getBoundingClientRect().width>0&&
 getComputedStyle(el).visibility!=='hidden';
return {hasEmail:!!visible(email),hasPassword:!!visible(password),
 width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
 title:document.title,readyState:document.readyState};`,
     args:[],
    });
    if(state.hasEmail&&state.hasPassword)break;
    await sleep(550);
   }
   const screenshot=await cmd('GET',path+'/screenshot');
   await writeFile('qa-live-browser/'+mode.name+'.png',
    Buffer.from(screenshot,'base64'));
   if(!state.hasEmail||!state.hasPassword)
    throw Error('PUBLIC_CRM_LOGIN_NOT_RENDERED_'+mode.name);
   if(mode.mobile&&state.width!==mode.width)
    throw Error('MOBILE_VIEWPORT_INCORRECT_'+JSON.stringify(state));
   if(state.scrollWidth>state.width+2)
    throw Error('PUBLIC_CRM_HORIZONTAL_OVERFLOW_'+mode.name+'_'+JSON.stringify(state));
   console.log('ORYNEO_CHROME_PUBLIC_BROWSER_PASS',JSON.stringify({mode:mode.name,
    viewport:state.width,loginVisible:true,title:state.title,readOnly:true}));
  }finally{
   await cmd('DELETE',path).catch(()=>{});
  }
 }
} catch(e){
 console.error('ORYNEO_CHROME_PUBLIC_BROWSER_FAIL',safeError(e));
 process.exitCode=1;
} finally{
 driver.kill('SIGTERM');
}
