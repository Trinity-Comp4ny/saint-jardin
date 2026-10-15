# ADR-0011: Migrations aplicadas automaticamente no merge na main

**Status:** aceito
**Data:** 15/10/2026
**Relaciona:** [ADR-0010](./0010-fluxo-v2-video-primeiro-contato-followup.md)

## Contexto

Até aqui as migrations eram coladas à mão no painel do Supabase (0006 e 0007 no mesmo dia). Isso
depende de lembrar a ordem, não deixa registro do que foi aplicado e já causou drift: o CHECK de
`conversas.estado` foi removido por um `.sql` solto fora da pasta, então um banco montado só pelas
migrations recusaria os estados novos. O repositório também não tinha nenhum workflow: a Vercel
publicava no merge sem typecheck nem testes no GitHub.

## Decisão

Um workflow só, `.github/workflows/ci.yml`:

- **Em toda PR:** typecheck, vitest e as migrations aplicadas duas vezes num Postgres 17 limpo (a segunda
  passada prova que reaplicar é seguro). Também checa que o schema aceita o que o código grava e
  recusa migration com `drop table|schema|column`, `truncate` ou `delete from` sem `-- allow-destructive`
  no arquivo.
- **No push na main:** `supabase db push` no environment `production`, depois de `test` e
  `migrations-check`. Um `--dry-run` antes lista as pendentes no log. `concurrency` sem cancelar.
- Segredo `SUPABASE_DB_URL` (Session Pooler, IPv4) só no environment `production`, que só aceita deploy
  da `main`. Permissões do workflow: `contents: read`. Ações fixadas por SHA, CLI com versão fixa.
- Migration `0008` alinha a pasta com o banco real (remove o CHECK de estado, cria `visitas`), em
  modo idempotente.

O banco de produção nunca teve histórico de migrations. A primeira execução reaplica 0001 a 0008, o que é
seguro porque todas são idempotentes (verificado com o banco de produção simulado, ver abaixo). Nenhum
baseline manual é necessário.

## Consequências

- Migration nova vai na pasta com número sequencial (`0009_...`), não timestamp: um timestamp ficaria
  sempre acima de `0007` e bagunçaria a ordem.
- A Vercel e o job de migrations disparam juntos no merge, sem ordem garantida. Migration tem que ser
  aditiva e o código tolerar a coluna ainda ausente (como o fallback do `#reset`).
- Não há staging de banco: o primeiro lugar onde a migration roda contra dados reais é a produção. A
  rede de proteção é o teste em banco limpo, o `--dry-run` no log e, opcionalmente, "Required reviewers"
  no environment `production` para exigir um clique antes de aplicar.
- Fora do escopo: backup noturno (o plano gratuito do Supabase não tem backup).

## Verificação feita

Com Postgres 17 em Docker: as 8 migrations aplicam duas vezes sem erro; sem a 0008 a checagem de
schema falha (prova que ela pega o drift); a CLI sem `config.toml` aplica no banco vazio (8 registradas) e
num banco igual ao de produção (tudo aplicado à mão, sem histórico), e a segunda execução diz "up to date".
