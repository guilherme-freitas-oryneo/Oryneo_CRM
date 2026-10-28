alter table public.crm_wa_ai_settings
  add column training_config jsonb not null default jsonb_build_object(
    'business_context','A ORYNEO organiza processos comerciais, CRM, automações e relacionamento com clientes.',
    'tone','Leve, direto, humano e educado. Sem formalidade excessiva.',
    'objective','Entender o cenário do lead, qualificar a oportunidade e conduzir para um diagnóstico com a equipe.',
    'qualification_questions','Qual é o principal desafio comercial hoje?\nComo os contatos são organizados atualmente?\nQuem participa da decisão?\nExiste uma urgência ou prazo para resolver isso?',
    'guardrails','Não inventar preços, prazos, resultados, funcionalidades ou garantias. Não insistir quando houver recusa.',
    'handoff_rule','Encaminhar para uma pessoa quando houver pedido de preço, negociação, reclamação, dúvida sem resposta segura ou solicitação explícita de atendimento humano.'
  );

alter table public.crm_wa_ai_settings
  add constraint crm_wa_ai_training_object check (jsonb_typeof(training_config) = 'object');
