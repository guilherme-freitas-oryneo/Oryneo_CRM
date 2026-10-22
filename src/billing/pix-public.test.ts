import {describe,expect,it} from 'vitest';
import {verifiedPixPresentation} from '../../supabase/functions/_shared/billing/pix-public';

const order={id:'11111111-1111-4111-8111-111111111111',amount_total:173980};
const session={id:'cs_test_123',mode:'payment',status:'open',livemode:false,currency:'brl',amount_total:173980,payment_intent:'pi_test_123',metadata:{oryneo_order_id:order.id}};
const intent={id:'pi_test_123',status:'requires_action',livemode:false,currency:'brl',amount:173980,metadata:{oryneo_order_id:order.id},next_action:{type:'pix_display_qr_code',pix_display_qr_code:{data:'00020101021226890014br.gov.bcb.pix520400005303986',image_url_png:'https://qr.stripe.com/test_example.png',expires_at:1_800_000_000}}};

describe('Pix QR já gerado pela Stripe',()=>{
 it('entrega QR e Copia e Cola somente quando sessão e PaymentIntent pertencem ao mesmo pedido',()=>{
   expect(verifiedPixPresentation(order,session,intent,false,1_790_000_000)).toEqual({
     status:'ready',copy_paste:intent.next_action.pix_display_qr_code.data,
     qr_code_url:intent.next_action.pix_display_qr_code.image_url_png,
     expires_at:new Date(1_800_000_000_000).toISOString(),
   });
 });
 it('não exibe Pix de outro pedido ou ambiente',()=>{
   expect(()=>verifiedPixPresentation(order,session,{...intent,amount:999},false)).toThrow('PIX_ORDER_MISMATCH');
   expect(()=>verifiedPixPresentation(order,session,{...intent,livemode:true},false)).toThrow('PIX_ORDER_MISMATCH');
   expect(()=>verifiedPixPresentation(order,session,{...intent,metadata:{oryneo_order_id:'outro'}},false)).toThrow('PIX_ORDER_MISMATCH');
 });
 it('não exibe QR expirado nem URLs de imagem fora da Stripe',()=>{
   expect(verifiedPixPresentation(order,session,intent,false,1_800_000_001)).toEqual({status:'expired'});
   expect(verifiedPixPresentation(order,session,{...intent,next_action:{...intent.next_action,pix_display_qr_code:{...intent.next_action.pix_display_qr_code,image_url_png:'https://evil.example/qr'}}},false,1_790_000_000)).toBeNull();
 });
 it('não cria segunda cobrança quando a tentativa está em processamento',()=>{
   expect(verifiedPixPresentation(order,session,{...intent,status:'processing'},false)).toEqual({status:'processing'});
 });
});
