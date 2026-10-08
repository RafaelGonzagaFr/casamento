# Validação da conversão

## Verificações concluídas

- `npm run check`: sintaxe dos arquivos JavaScript validada.
- `npm test`: **22 testes aprovados**, sem falhas.
- `npm audit --omit=dev --audit-level=high`: nenhuma vulnerabilidade conhecida reportada nas dependências de produção na execução realizada.
- Teste de frontend no DOM (JSDOM): login, navegação, geração de QR, RSVP, reserva, troca, cancelamento, configurações, cadastro e escape de HTML executados com o código real da interface e o backend local.
- `supabase/schema.sql`: tabelas, views, grants, RLS e funções criados e executados em PostgreSQL embutido (PGlite).

Os testes cobrem propriedade e prazo de RSVP; presença exigida para reserva; unicidade por convite e por presente; cancelamento somente pelo dono; troca válida após recusa de RSVP; manutenção da escolha anterior em conflito e em falha forçada de INSERT; arquivamentos; edição parcial; auditoria administrativa; limites por convite e global; inativos; acesso anon/authenticated barrado; isolamento das sessões; hashes dos links; revogação; CSRF; origem; login limitado; cadastros e rotas HTTP; validação de links, imagens e fuso.

Duas requisições HTTP simultâneas para o mesmo presente resultaram em uma reserva aceita e uma recusada. O PGlite executa numa única conexão: essa verificação não substitui um teste de concorrência com duas conexões em uma instância Supabase. Os índices únicos parciais e as transações foram verificados diretamente no PostgreSQL embutido.

## Limites da validação

O projeto Supabase do usuário não foi acessado, porque suas credenciais não foram fornecidas. Nos testes HTTP, o login e o Storage usam adaptadores locais de teste; as queries e RPCs executam no PostgreSQL embutido. Login real no Supabase Auth, envio real de fotos e funcionamento em uma hospedagem HTTPS dependem da configuração descrita no README.

A verificação visual com navegador não foi concluída: o ambiente não disponibilizou um executável de navegador utilizável. CSS responsivo e HTML foram implementados, mas aparência em diferentes dispositivos deve ser conferida após iniciar o aplicativo.

Não foram importados dados: o arquivo Laravel recebido contém somente o código, sem um dump do banco. A conversão foi entregue como um projeto separado.
