# Homologação WhatsApp e proteção financeira — 2026-10-28

## Estado publicado

- Meta Business verificado, app `Oryneo_01` publicado e conta oficial inscrita no campo `messages`.
- Número oficial `+55 21 97451-0932` associado ao canal do CRM.
- Webhook, caixa de entrada e mídia ativos no Supabase; canal habilitado após a implantação das regras de acesso.
- Envio e recebimento implementados para texto, imagem, vídeo, áudio e documento.
- Resposta citada, reações, confirmação de envio/entrega/leitura e exclusão local por operador implementadas.
- Upload validado no servidor, com limites de 5 MB para imagem e 16 MB para os demais tipos aceitos.
- Eventos de estorno Stripe passam a ser reconciliados de forma idempotente em teste e produção.

## Proteções preservadas

- Nenhum arquivo da landing page foi alterado.
- O fluxo existente de criação de proposta, entrega de link, e-mail transacional, checkout e pós-pagamento foi preservado.
- O webhook financeiro continua exigindo assinatura Stripe e separação estrita entre teste e produção.
- Estorno parcial mantém o pedido pago; apenas a soma integral de estornos confirmados marca o pedido como estornado.
- Eventos repetidos não duplicam a movimentação nem o e-mail transacional.

## Verificações executadas

- Frontend: 55 arquivos de teste e 343 testes aprovados.
- Build de produção para `/Oryneo_CRM/` aprovado.
- Edge Functions: typecheck de WhatsApp e Stripe aprovado.
- Contratos Deno: 16 testes aprovados.
- Banco descartável: regras de acesso do WhatsApp e reconciliação de estorno aprovadas.
- Produção: funções públicas rejeitam token, autenticação ou assinatura inválidos conforme o contrato.

## Limites da plataforma

- A Cloud API não oferece encaminhamento nativo com o selo “Encaminhada”.
- A Cloud API não oferece “apagar para todos”; “apagar para mim” é local e individual por operador no CRM.
- Foto de perfil do contato não é entregue no webhook atual; a interface usa iniciais.
- Chamada de voz pertence à WhatsApp Calling API e exige uma homologação separada. Videochamada não faz parte do canal Cloud API configurado.

## Teste operacional final

O teste real deve usar o CRM autenticado e um segundo aparelho: enviar e receber texto, imagem, vídeo e áudio; responder e reagir; conferir os estados enviado, entregue e lido; e validar a exclusão local. Uma compra real em BRL depende da conclusão do checkout pelo titular do cartão ou da conta Pix. O sistema não cria cobrança real silenciosamente.

## Evidência real de mídia

Em 2026-10-28, o número oficial recebeu e processou sem erro uma imagem JPEG, um vídeo MP4, uma resposta citando a imagem e uma reação `👏` associada à mesma mensagem. A interface passou a carregar imagens e vídeos automaticamente quando entram na área visível da conversa. O vídeo usa controles nativos, carrega somente os metadados necessários e exibe a duração em `minutos:segundos`.
