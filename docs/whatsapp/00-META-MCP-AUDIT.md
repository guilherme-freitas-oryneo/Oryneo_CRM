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

Próxima ação do titular: completar o [perfil empresarial Meta](https://business.facebook.com/settings/info/?business_id=1098665735949825) e conferir em [Apps do negócio](https://business.facebook.com/latest/settings/apps/?business_id=1098665735949825&nav_ref=whatsapp_business_tools_mcp) se já existe app WhatsApp da ORYNEO e se esta conta possui administração. Não criar app/número novo até essa verificação para evitar duplicação. Se for necessária verificação empresarial, usar o [Security Center](https://business.facebook.com/latest/settings/security_center/?business_id=1098665735949825&nav_ref=whatsapp_business_tools_mcp). Essas telas exigem dados/consentimentos do titular. O Codex CLI cloud ainda requer OAuth próprio se ele for usado para administrar o MCP fora do conector desta conversa.

O MCP é administrativo. A leitura comprova acesso ao portfólio nesta conversa, mas não confirma a Página pública do Facebook, a elegibilidade do número, envio/recebimento da Cloud API nem saúde do CRM.
