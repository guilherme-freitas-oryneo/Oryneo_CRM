# Execução e-mail e pipeline — 17/10/2026
Base: ef60775. Autorizado pelo usuário: executar plano de e-mail, revisar pipeline, corrigir problemas e duplicar cards.
Marca: docs/oryneo-email-brand-alignment-v1.1-20261013.md; Graphite #0F1115, Indigo #4F6BFF, CTA #4357E8, Off-white #F8F7F4. Preservar assets oficiais.
Referências: https://support.pipedrive.com/en/article/how-can-i-duplicate-a-deal e https://knowledge.hubspot.com/records/clone-a-record
## Escopo e decisões
- Reutilizar Radix já instalado para menus; sem nova biblioteca visual.
- Duplicação existe, mas espalha todos os campos. Copiar somente cadastro comercial, reiniciar atividade e escolher etapa em formulário; não copiar first_contact, quote/aceite/cobranças, notas ou atribuição de aquisição. Fonte Duplicação e vínculo ao original.
- Prioridade do pipeline: duplicação segura, filtros por próxima ação e sinalização de retorno atrasado; preservar configuração de etapas, mover/desfazer e ativos.
- E-mail: corrigir destinatários descartados silenciosamente, chave de retry, limites; rascunhos no servidor com anexos; menus e ações; exportação .eml original por IMAP; quota IMAP quando suportada; corrigir respostas assíncronas antigas e atualização que elimina páginas carregadas.
- Rascunhos são privados por autor via endpoints autenticados e política de leitura RLS restrita ao autor. Payload de anexos permanece no JSON existente com limite total seguro; sem nova tabela.
- Não enviar e-mails a clientes reais na homologação.
## Baseline
152 testes: 148 passaram, 4 falharam. Duas falhas em Mailbox: mock não exporta MAIL_THREADS_PAGE_SIZE; uma na galeria: teste antigo espera 8 cenários/heading antigo; uma de horário fixa UTC apesar do fuso local. Investigar e corrigir os testes sem alterar funcionalidades aprovadas da galeria/data.
## Marcos
- 10% desta implementação: inspeção do código, baseline e referências concluídos. Não altera os 50% da homologação global histórica.
