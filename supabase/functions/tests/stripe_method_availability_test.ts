import {assertEquals} from 'jsr:@std/assert';
import {checkStripeMethodAvailability} from '../_shared/billing/stripe-method-availability.ts';
import type {BillingEnvironmentConfig} from '../_shared/billing/environment.ts';
const config:BillingEnvironmentConfig={environment:'test',livemode:false,secretKey:'sk_test_fake',publishableKey:'pk_test_fake'};
const mock=(data:unknown,status=200)=>async()=>new Response(JSON.stringify(data),{status});
Deno.test('disabled Stripe TEST boleto and Pix cannot be offered even when LIVE supports them',async()=>{
 const data={has_more:false,data:[{active:true,livemode:false,card:{available:true,display_preference:{value:'on'}},boleto:{available:false,display_preference:{value:'off'}},pix:{available:false,display_preference:{value:'off'}}}]};
 assertEquals((await checkStripeMethodAvailability('card',config,mock(data) as typeof fetch)).available,true);
 assertEquals((await checkStripeMethodAvailability('boleto',config,mock(data) as typeof fetch)).available,false);
 assertEquals((await checkStripeMethodAvailability('pix',config,mock(data) as typeof fetch)).available,false);
});
Deno.test('availability fails closed for wrong mode, multiple configurations and provider errors',async()=>{
 const entry={active:true,livemode:true,pix:{available:true,display_preference:{value:'on'}}};
 assertEquals((await checkStripeMethodAvailability('pix',config,mock({has_more:false,data:[entry]}) as typeof fetch)).available,false);
 assertEquals((await checkStripeMethodAvailability('pix',config,mock({has_more:true,data:[entry]}) as typeof fetch)).available,false);
 assertEquals((await checkStripeMethodAvailability('pix',config,mock({data:[]},503) as typeof fetch)).available,false);
});
