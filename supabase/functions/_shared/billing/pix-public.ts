/** Only reads a Pix QR that Stripe has already generated for an authenticated order.
 * Never creates/ confirms a charge. The webhook remains the source of paid status. */
export type PublicPixDetails =
  | {status:'ready';copy_paste:string;qr_code_url:string;expires_at:string}
  | {status:'expired'|'processing'};

type Order={id:string;amount_total:number};
type Session={id?:string;status?:string;mode?:string;livemode?:boolean;currency?:string;amount_total?:number;payment_intent?:string|null;metadata?:Record<string,string>};
type Intent={id?:string;status?:string;livemode?:boolean;currency?:string;amount?:number;metadata?:Record<string,string>;next_action?:{type?:string;pix_display_qr_code?:{data?:string;image_url_png?:string;expires_at?:number}}};

export function verifiedPixPresentation(order:Order,session:Session,intent:Intent,expectedLive:boolean,now=Math.floor(Date.now()/1000)):PublicPixDetails|null{
  if(session.mode!=='payment'||session.livemode!==expectedLive||intent.livemode!==expectedLive
    ||session.currency!=='brl'||intent.currency!=='brl'
    ||session.amount_total!==order.amount_total||intent.amount!==order.amount_total
    ||session.payment_intent!==intent.id
    ||session.metadata?.oryneo_order_id!==order.id
    ||intent.metadata?.oryneo_order_id!==order.id)
      throw new Error('PIX_ORDER_MISMATCH');
  if(intent.status==='processing'||intent.status==='succeeded')return {status:'processing'};
  if(intent.status!=='requires_action'||intent.next_action?.type!=='pix_display_qr_code')return null;
  const qr=intent.next_action.pix_display_qr_code;
  if(!qr||!Number.isFinite(qr.expires_at))return null;
  if(qr.expires_at!<=now)return {status:'expired'};
  const copy=qr.data, image=qr.image_url_png;
  if(typeof copy!=='string'||copy.length<30||copy.length>2048||typeof image!=='string')return null;
  let url:URL;try{url=new URL(image)}catch{return null}
  if(url.protocol!=='https:'||url.hostname!=='qr.stripe.com'||url.username||url.password)return null;
  return {status:'ready',copy_paste:copy,qr_code_url:url.toString(),expires_at:new Date(qr.expires_at!*1000).toISOString()};
}
