# Meta MCP — auditoria de acesso

Data: 2026-10-24 UTC. Ambiente: Codex CLI em workspace cloud desta sessão.

| Etapa | Observação |
| --- | --- |
| Registro inicial | `codex mcp list`: nenhum servidor configurado. |
| Servidor registrado | `whatsapp_business_tools`, Streamable HTTP, `https://mcp.facebook.com/whatsapp_business_tools`; `codex mcp get` confirma nome, URL e transporte. |
| Alcance HTTP | GET sem autenticação recebeu HTTP 405; isso não demonstra OAuth nem acesso a negócio. |
| OAuth | O **conector Meta desta conversa** passou a expor `whatsapp_biz_*` e retornou uma leitura de negócio após o proprietário autenticar. O **Codex CLI cloud**, consultado de novo, continua `Not logged in`; são contextos de autenticação distintos. Nenhuma credencial foi copiada para repositório. |
| Negócio acessível | `whatsapp_biz_businesses(action=list)` retornou exatamente um portfólio: Business ID `1098665735949825`, `ORYNEO \| CRM e Marketing`. Perfil empresarial incompleto, verificação empresarial ainda não aprovada. |
| App e contas | O checklist retornou `apps_on_business=0` para apps administrados por esta conexão. A listagem de contas de mensagens de produção retornou zero linhas acessíveis; o próprio resultado informa que só há conta de teste, inadequada para tráfego de produção. Isso não prova ausência de app/conta fora das permissões atuais. |
| Número comercial | Consulta direta por `+5521974510932` não encontrou número visível neste acesso. Isso não prova que o número esteja livre nem que não exista em outra conta. Nenhuma ação de vinculação foi executada. |
| Webhooks | Para este portfólio, o checklist retornou zero apps administrados e nenhum webhook/app subscription configurável no escopo lido. Não há webhook Cloud API operacional comprovado. |

Próxima ação do titular: completar o [perfil empresarial Meta](https://business.facebook.com/settings/info/?business_id=1098665735949825) e conferir em [Apps do negócio](https://business.facebook.com/latest/settings/apps/?business_id=1098665735949825&nav_ref=whatsapp_business_tools_mcp) se já existe app WhatsApp da ORYNEO e se esta conta possui administração. Se for necessária verificação empresarial, usar o [Security Center](https://business.facebook.com/latest/settings/security_center/?business_id=1098665735949825&nav_ref=whatsapp_business_tools_mcp). Essas telas exigem dados/consentimentos do titular. O Codex CLI cloud ainda requer OAuth próprio se ele for usado para administrar o MCP fora do conector desta conversa.

## Novo mandato e bloqueio de identidade (2026-10-24)

O titular autorizou expressamente criar um app novo, pois o app recente não foi configurado e ele não consegue acessá-lo. A captura enviada mostra a Meta recusando o método de verificação no navegador móvel e pedindo computador ou aplicativo do Facebook na mesma conta; também oferece “Usar outro método”. Isso é um desafio de identidade do titular, não uma etapa que possa ser respondida pelo MCP. Não foram recebidos códigos, tokens ou credenciais.

Nova leitura `whatsapp_biz_businesses`: o portfólio `1098665735949825` segue com perfil incompleto e sem app WhatsApp administrado por esta conexão. `whatsapp_biz_verify_business` informa verificação empresarial não aprovada. O inventário de ferramentas Meta disponibiliza consulta, número, webhook, template e publicação, mas **não** criação de developer app, concessão de administração ou edição do perfil empresarial. Não há navegador autenticado/controlável neste ambiente. A listagem de nomes dos GitHub Actions secrets retornou HTTP 403 para esta integração, sem acesso a eventual App ID ali.

Assim, a autorização para criar app existe, mas a capacidade técnica e o desafio de identidade faltam. O passo mínimo do titular é concluir o método de verificação no app do Facebook ou em computador com a mesma conta; em seguida abrir o perfil empresarial e a lista de apps. Não adicionar o número comercial antes de haver app administrado e perfil completo. Repetir o inventário Meta após a ação; se o app recente continuar inacessível, criar novo app no painel Meta Developers com caso de uso WhatsApp Business Messaging e vinculá-lo a este portfólio, sem duplicar contas/números.

O MCP é administrativo. A leitura comprova acesso ao portfólio nesta conversa, mas não confirma a Página pública do Facebook, a elegibilidade do número, envio/recebimento da Cloud API nem saúde do CRM.
