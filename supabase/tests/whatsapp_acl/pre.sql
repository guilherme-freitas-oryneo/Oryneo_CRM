insert into public.crm_wa_channels(business_id,app_id,messaging_account_id,phone_number_id,display_phone_number)
values('1098665735949825','2617801045397651','28794700556857948','1322421900964911','+5521974510932');
insert into public.crm_wa_conversations(channel_id,customer_wa_id)
select id,'5521999999999' from public.crm_wa_channels;
insert into public.crm_wa_messages(conversation_id,provider_message_id,direction,kind,body,occurred_at)
select id,'wamid.local','inbound','text','local test',now() from public.crm_wa_conversations;
