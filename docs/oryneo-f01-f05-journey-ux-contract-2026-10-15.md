# ORYNEO · Contratos de UX entre e-mails e páginas F01–F05
**15/10/2026 — Proposta de implementação; NÃO é evidência de funcionalidade em produção.**

## Fontes e limites do inventário
- Repositórios existentes: `Oryneo_Landing_Page`, `Oryneo_CRM`, `Oryneo_Control_Center` (GitHub).
- Na landing institucional, há página `/comecar/` com formulário multi-etapas e confirmação de recebimento após aceite; os componentes `assets/lead-intake.js` e `assets/submission-confirmation.js` fazem parte do fluxo. Isso **não comprova a publicação das cinco frentes F01–F05**.
- No CRM, há entrada `/pagar/` e implementação Stripe em desenvolvimento. A existência dos arquivos não comprova checkout de produção homologado.
- Biblioteca real: 45 e-mails como estudos de Canva; renderizadores existentes para 12 transacionais + dois primeiros contatos. Não vincular `href` fictício a qualquer peça.

## Fluxo sem redundância
```text
Landing /comecar → POST intake verificado → confirmação na página [1×] → E16 recibo [opcional, 1×]
  ├─ Conversa solicitada → E14 humano → WhatsApp contextual → reunião E31 → E44 lembrete
  └─ Contratação solicitada → E15 alinhamento WhatsApp → F01 proposta → E17 aviso/URL da proposta
         → aceite de versão F01 → F02 pedido/checkout E18 → evento financeiro
         → E06 pendente (se aplicável) / E07 falha / E09 ou E13 confirmação no ciclo apropriado
         → F03 implantação (E19–E22) → F04 LP se contratada (E26–E27)
         → serviços e operação (E28–E45 conforme eventos/autorizações)
         → F05 encerramento/exportação (E25/E41), quando aplicável.
```
**Importante:** A trilha acima é um **contrato de produto proposto**, não automação já existente.

## F01 · Proposta individual e aceite auditável
**Entrada autorizada:** E17 carrega link individual gerado no servidor; não reutilizar URL de `/comecar/` nem criar `/proposta/123` no design.

**Página de proposta:** título contextual da empresa, versão e validade quando definidas, comparação sem ambiguidades de plano/ciclo/implantação/add-ons, investimento inicial, recorrência futura, condições e dados do responsável. Hierarquia própria de avaliação, diferente da linguagem de pagamento.

**Ações:** `Revisar condições`, `Solicitar ajuste` (conversa pelo canal comercial autorizado) e `Aceitar esta versão`, este último registrado pelo servidor com identidade, versão imutável, horário, consentimento e hash da proposta. Consulta não equivale a aceite. WhatsApp não serve como assinatura ou aceite presumido.

**Estados:** carregando, proposta válida, vencida, substituída, revisada, aceita, bloqueada por falta de autorização. Não expor dados a outros tenants.

**Gate E17 → E18:** E18 só pode existir se F01 aceito e F02 pedido seguro criado para a versão aceita.

## F02 · Pedido, Stripe e pagamento
**Página de checkout:** destacar o valor de HOJE, a data/ciclo de próximas cobranças, implantação e addons discriminados, referência, status real e canal de apoio. Design é transacional/financeiro, não página promocional. Não permitir que o WhatsApp pareça processador de pagamento.

**Ações:** `Revisar pedido e pagar` abre sessão Stripe/checkout autorizada e conferível no servidor. Em divergência: `Esclarecer pelo WhatsApp` como ação secundária antes de qualquer pagamento.

**Estados:** pronto, link expirado, pagamento em confirmação, recusado, pago, cancelado, duplicado, disputado; reemissão cria sessão nova com referência rastreável. Eventos verificados e idempotentes. Garantir que `E06` não incentive um segundo pagamento enquanto o primeiro ainda está pendente.

**Gates:** reconciliar webhook assinado, pedido, assinatura, contrato, provisionamento, dado financeiro e emissões. Não afirmar acesso liberado só porque houve redirecionamento `success`.

## F03 · Área de implantação do cliente
**Página de andamento:** exibir primeiro marco, marcos concluídos, responsável real, dependências, próxima previsão somente quando cadastrada, registros de entrega e status de provisionamento. Diferenciar `contratação confirmada` E13, `implantação iniciada` E19, `dados pendentes` E20, `CRM disponível` E21 e `escopo concluído` E22.

**Ações:** verificar pendências e enviar documentos **por canal seguro autenticado**; WhatsApp serve para esclarecer, não para coletar senha, token, credenciais ou documentos sensíveis. CTA `Acessar ambiente` somente se o tenant e permissões já estão provisionados.

**Estados:** aguardando kickoff, em execução, aguardando cliente, pronto para validação, entregue, concluído. E19 não deve repetir E13; E21 não deve declarar toda a implantação concluída.

## F04 · Prévia e publicação da landing page contratada
**Página de prévia:** versão identificada, página completa, modo mobile/desktop, dados comerciais e formulário verificados. Ações `Solicitar revisão` e `Aprovar versão`, com log de aceite; aprovação não deve ser inferida de uma visualização.

**Página publicada:** domínio efetivo, data de publicação verificada, número/ID da versão e testes mínimos de formulário + destino de lead. E26 = solicitação de revisão; E27 = comunicação de publicação já realizada. WhatsApp pode apoiar revisões, mas nenhuma URL de domínio pode ser inventada.

**Estados:** construção, revisão, ajustes solicitados, aprovada, publicação em andamento, no ar, indisponível/falha. Não declarar publicada quando o DNS ou formulário falhar.

## F05 · Encerramento e exportação de dados
**Página de encerramento:** referências de contrato, data efetiva, disponibilidade de acesso e prazos contratuais/legais reais. Não pressupor reembolso ou exclusão imediata; comunicar separadamente.

**Página de exportação:** link temporário, com autorização granular por tenant/papel, validação de identidade, logs de acesso, política de retenção e prazo. E41 só depois do pacote estar pronto. Nunca usar anexos públicos nem expor arquivo em conversa WhatsApp.

**Estados:** solicitado, autorizado, exportação em preparo, disponível, expirado, acesso encerrado; rotas de erro devem ser previsíveis.

## Convenções transversais das páginas
- Evitar chamadas genéricas (“Sua jornada começa aqui”) repetidas. Cada página deve resolver uma pergunta concreta: **o que foi enviado? o que devo avaliar? o que é cobrado? o que está pendente? o que já foi entregue?**.
- Brand Kit ORYNEO v1.1: Graphite `#0F1115`, Indigo `#4F6BFF`, Off-white `#F8F7F4`, tipografia Inter com fallback, PNGs oficiais de wordmark (sem reconstrução vetorial).
- Estabelecer componentes de marca reutilizáveis (cores, espaçamentos, foco, acessibilidade) mas variando hierarquia, conteúdo, visualização de estado e composição conforme a tarefa.
- Estados mobile-first, legibilidade sem zoom, foco teclado, links com propósito explícito, contraste AA nas interações, sem conteúdo truncado ou rolagem horizontal.
- E-mails em HTML + plain text. Links internos autenticados e gerados pelo backend; `wa.me/5521974510932` é um canal autorizado, mas **não transporta dados de pedido/pessoa** por parâmetro.
- Gatilhos por evento verificado, identificador de envio e supressão por destinatário/tenant/evento/versão. Registrar intenção de envio, aceitação pelo provedor e falha, sem duplicatas.

## Plano de testes e bloqueios de release
1. End-to-end de lead-intake → CRM → E16, sem disparo duplo ao voltar/recarregar; nenhum e-mail antes do aceite do formulário.
2. F01: acesso entre tenants negado, aceite versionado; E17/E18 não podem apontar para versão vencida.
3. F02: Stripe em test mode, falha, tentativa duplicada, expiração, webhook replay, reconciliação de status; uma confirmação, não duas.
4. F03/F04: pendência e entrega individual; layout real de e-mail E19–E22/E26–E27 diferente da página, com dados iguais.
5. F05: assinatura/tenant sem autorização deve ser negado; expiração de link testada.
6. Regressão de páginas existentes e e-mails já habilitados; teste de envio apenas em ambiente de homologação com destinatários de teste.
7. QA visual desktop, smartphone real, Gmail/Outlook/Apple Mail, HTML/texto simples e contraste; nenhuma peça promovida no Canva sem aprovação explícita.

**Status:** Documento de especificação, não implementação. Nenhuma URL de produção foi criada, nenhum deploy/habilitação de e-mail foi feito por esta entrega.
