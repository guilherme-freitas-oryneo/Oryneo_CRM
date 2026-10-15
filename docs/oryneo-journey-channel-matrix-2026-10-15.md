# ORYNEO · Matriz de continuidade editorial e canais
Data: 15/10/2026 · Revisão em branch isolada · **NÃO HABILITA DISPAROS**

## Regras de produto e direção criativa
- O e-mail é registro confiável de eventos, propostas, segurança, documentos, cobrança e decisões formalizadas. WhatsApp é canal de conversa e acompanhamento contextual, **não** aprova contrato nem substitui autenticação, pagamento ou envio protegido de documentos.
- Telefone autorizado provisoriamente pelo cliente: `5521974510932`; URL: `https://wa.me/5521974510932`. Não incluir dados pessoais, referências de pedido, tokens ou documentos no texto pré-preenchido de links.
- Cada email precisa ter um motivo para existir, ser disparado uma vez por evento, indicar o próximo passo real e não duplicar a mesma conversa. E16 (recebimento) não é substituto do contato comercial humano E14/E15.
- Um botão em **Canva** é representação visual. Somente HTML/fluxo real com `href` validado permite tratar o CTA como funcional. Nunca anunciar link seguro, página publicada ou cobrança confirmada sem URL e evento verificáveis.
- Nenhum texto deve instruir o cliente a responder por e-mail como condição necessária para continuar. Respostas por e-mail podem continuar disponíveis quando há contexto de suporte/auditoria, mas não são a rota obrigatória.
- Marca: utilizar o wordmark oficial da ORYNEO. Não criar logotipos alternativos. Para o WhatsApp, usar marca gráfica somente a partir dos ativos oficiais da Meta e em conformidade com suas regras; caso contrário, usar CTA textual sem logotipo.
- Preservar 4 masters formalmente aprovados: E13, E18, E21 e E35. Correções propostas são rascunhos independentes até QA/aceite.
- Linguagem, ritmo de informação e composição devem variar conforme o evento; componentes da marca podem ser reutilizados, mas não transformar 45 mensagens em uma única carcaça repetida.

## Catálogo e decisões de CTA

| ID | Papel exclusivo na jornada | CTA principal / canal | WhatsApp complementar | Bloqueio necessário |
|---|---|---|---|---|
| E01 | Confirmar endereço de e-mail | Confirmar e-mail · link nativo Auth | Não | Token individual e válido |
| E02 | Redefinir senha | Criar nova senha · Auth | Não | Token válido |
| E03 | Aceitar convite | Aceitar convite · Auth | Não | Convidante e tenant autorizados |
| E04 | Avisar alteração de senha | Nenhuma ação em alteração reconhecida; suporte de segurança em incidente | Não | Evento real |
| E05 | Avisar mudança de e-mail | Contato de segurança se não reconhecido | Não | Evento real |
| E06 | Pagamento ainda em confirmação | Sem novo pagamento; aguardar confirmação | Não | Estado pendente verificável |
| E07 | Falha de pagamento inicial | Revisar pagamento · link seguro | Sim, para dúvidas | Pedido válido e não duplicado |
| E08 | Link de checkout expirou | Solicitar novo link · fluxo autorizado | Sim, para orientação | Expiração confirmada |
| E09 | Renovação paga | Recibo informativo, sem ação | Não | Fatura liquidada |
| E10 | Renovação falhou | Consultar cobrança · link seguro | Sim, para dúvidas | Falha confirmada |
| E11 | Assinatura cancelada | Registro e efeitos do contrato | Não | Cancelamento efetivo |
| E12 | Reembolso confirmado | Registro financeiro, sem ação | Não | Processador confirmou |
| E13 | Boas-vindas após contratação | Cronologia real da implantação | Opcional, somente se houver responsável real | Pagamento/contrato confirmado |
| E14 | Primeiro contato comercial — conversa | Conversar pelo WhatsApp | É o CTA principal | Ação comercial autorizada |
| E15 | Primeiro contato comercial — contratação | Alinhar configuração via WhatsApp | É o CTA principal | Ação comercial autorizada |
| E16 | Receber solicitação pelo formulário | Confirmar registro; WhatsApp para contexto adicional | Sim | Intake persistido e deduplicado |
| E17 | Entregar proposta versionada | Ver proposta em página autenticada | Sim, para ajustes | F01 publicada e autorizada |
| E18 | Liberar pedido após aceite | Revisar pedido e pagar | Sim, para divergências **antes** do pagamento | F01 aceita + F02 pedido e URL real |
| E19 | Informar início de implantação | Marco, responsável e próxima atualização | Sim, apenas alinhamento | F03 kickoff real |
| E20 | Solicitar materiais de implantação | Envio por canal seguro futuro | Sim, para combinar envio, **nunca credenciais** | F03 pendências reais + canal seguro |
| E21 | Liberar acesso ao ambiente | Acessar CRM | Somente suporte se houver bloqueio | Tenant provisionado + isolamento validado |
| E22 | Registrar entrega concluída | Relatório do escopo efetivamente entregue | Sem CTA obrigatório | Validação e aceite de entrega |
| E23 | Abrir atendimento de suporte | Protocolo e continuidade de canal escolhido | Condicional ao canal do ticket | Chamado único |
| E24 | Informar resolução de suporte | Resumo da resolução; reabrir no canal do protocolo | Condicional | Resolução verificada |
| E25 | Registrar encerramento contratual | Datas e exportação / termos | Não como substituto contratual | F05 finalizado |
| E26 | Enviar landing page para revisão | Revisar prévia e registrar aceite | Sim, apenas dúvidas | F04 prévia publicada e restrita |
| E27 | Confirmar publicação de landing page | Abrir site final | Sim, apenas suporte | F04 publicação + teste de formulário |
| E28 | Confirmar campanhas ativadas | Resumo verificado, sem promessas | Opcional, responsável da conta | Campanhas realmente ativas |
| E29 | Entregar relatório de tráfego | Consultar relatório autenticado | Sim, para interpretação de resultados | Métricas e período verificados |
| E30 | Avisar próximo ciclo de gestão de tráfego | Ver contrato/cobrança, sem cobrança fictícia | Não obrigatório | Ciclo contratual validado |
| E31 | Confirmar reunião | Calendário / link individual | Sim, para imprevistos | Evento confirmado |
| E32 | Informar nova data de reunião | Confirmar agenda atualizada | Sim, para ajustar horário | Evento remarcado |
| E33 | Cancelar reunião | Registro do cancelamento; retomar se desejado | Sim, para reabrir diálogo | Cancelamento real |
| E34 | Retomar conversa comercial | Próxima pergunta específica via WhatsApp | Sim | Contexto real e deduplicação |
| E35 | Disponibilizar NFS-e | Consultar documento fiscal | Não substituir documento | Nota fiscal emitida |
| E36 | Confirmar mudança de plano | Resumo de condições anteriores/novas | Não como substituto do aditivo | Aditivo e data efetivos |
| E37 | Solicitar informação faltante do suporte | Responder pelo canal onde o ticket vive | Condicional | Pendência única e rastreável |
| E38 | Comunicar instabilidade | Status verificável + próxima atualização | Não como destino único | Incidente confirmado |
| E39 | Confirmar restabelecimento | Atualização do incidente | Não obrigatório | Serviço testado |
| E40 | Avisar acesso revogado | Contato de segurança se não reconhecido | Não | Revogação efetiva |
| E41 | Disponibilizar exportação | Link autenticado e temporário | Não | F05 + autorizações + expiração |
| E42 | Resumo interno do pipeline | Abrir cartões do CRM | Não | RLS, papel e preferências |
| E43 | Incidente técnico interno | Runbook ou ticket operacional | Não | Alertas autorizados |
| E44 | Lembrar reunião confirmada | Calendário, canal do encontro | Sim, para imprevistos | E31 + supressão de duplicatas |
| E45 | Avisar proximidade de renovação | Conferir cobrança/plano no ambiente seguro | Opcional, dúvidas sobre plano | Prazo real, regra de aviso |

## Dependências de páginas e telas
- **F01 · Proposta comercial:** não identificada como fluxo completo e homologado. Precisa URL individual, versões imutáveis da proposta, ajuste/aceite auditável e passagem F01 → F02. Sem isso, E17 não pode ser ativado.
- **F02 · Cobrança/checkout:** código Stripe em modo de desenvolvimento/teste já identificado. Exige revisão de estado de pedido, webhooks, reemissão, idempotência, confirmação real e segurança da URL antes de disparos E07/E08/E10/E18/E30/E45.
- **F03 · Área de implantação:** depende de criação real de pendências, marcos, responsáveis e estados de conclusão. E19–E22 não devem antecipar fatos.
- **F04 · Landing page do cliente:** prévia e publicação precisam de URLs distintas, aprovação identificada, versão, domínio e testes de formulário/contato; não inferir domínio.
- **F05 · Encerramento/exportação:** fluxo autenticado, autorização por tenant, retenção e pacote com expiração; E25/E41 dependem dele.
- **Landing institucional /comecar:** formulário existente envia solicitação e coleta WhatsApp. Mensagem de sucesso deve ser compatível com E16; contatos posteriores devem evitar repetição de confirmação.
- **Canva:** não permite certificar links HTML reais. Validar o modelo estético no Canva, a URL no renderizador HTML e a ação no servidor. Três QA separados.

## Decisões visuais para evitar "Ctrl+C, Ctrl+V"
- Acesso E01–E05: visual de autenticação/segurança, prioridade no gesto seguro, poucas linhas.
- Financeiro E06–E12 e E18/E30/E45: resumos numéricos ou linha de cobrança, não capas promocionais.
- Conversa E14–E16/E31–E34/E44: voz humana, pergunta concreta, espaços de respiro, CTA de conversa onde cabe.
- Proposta E17: composição editorial de condições e valor, "Ver proposta" como botão dominante, WhatsApp discreto.
- Implantação E19–E22: alternar cronograma, checklist de pendências, credenciais/acesso e termo de entrega.
- Suporte E23–E24/E37–E39: protocolos, histórico, diagnóstico e restabelecimento; visual de operação, não de vendas.
- LP e tráfego E26–E29: elementos de revisão, domínio/versão, ativações e indicadores reais.
- Operação e compliance E25/E35/E36/E40–E43: registro formal, menor ornamentação e informações verificáveis.

## Gates de homologação (não cumpridos por este documento)
1. Aprovação de copy/visual por peça (45/45), com prova de não sobreposição e leitura mobile.
2. CTA de cada peça com URL real, evento habilitador e texto simples equivalente.
3. Integração F01–F05 e telemetria de clique/estado, sem callbacks inventados.
4. Testes de renderização em Gmail, Outlook e Apple Mail, modo claro/escuro.
5. Conferência de idempotência, segurança, RLS, links temporários e templates Supabase Auth nativos.
6. Revisão de cadência/supressão: E16 versus E14/E15, E31 versus E44, E38 versus E39, E06 versus E09, E17 versus E18.
7. Aprovação explícita, só então merge, deploy e ativação de novos envios.
