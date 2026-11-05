# Controle de Contratos

Gestão de contratos de entrega parcelada, em rede e com vários usuários ao mesmo tempo.
Substitui a planilha: o **prazo** e o **saldo** de cada contrato aparecem no dashboard e se
atualizam sozinhos — o saldo é debitado a cada lançamento e o prazo corre com os dias.

## Como funciona

- **Um computador é o servidor** (guarda o banco SQLite); os demais **se conectam a ele**.
  Todos usam o mesmo aplicativo desktop (Electron). Na primeira abertura ele pergunta qual
  é o papel do PC: "Este computador é o servidor" ou "Conectar a um servidor da rede".
- Alterações aparecem **ao vivo** nas outras telas abertas (e avisam quem mexeu).
- Dá também para rodar só o servidor, sem janela, em um PC que fica ligado: `npm run server`
  (ou `iniciar-servidor.bat`), e todos os usuários abrem o app em modo cliente.

## Rodando

```bash
cd contratos
npm install
npm run desktop        # app (escolha servidor ou cliente)
npm run server         # só o servidor, porta 3210 (PORT=...); banco em contratos/dados/
npm test
npm run dist           # instalador Windows (electron-builder) -> contratos/dist/
```

Requer Node.js ≥ 22.13 (usa o SQLite embutido do Node). O PC servidor precisa liberar a
porta (padrão 3210) no firewall para a rede local.

## Modelo (igual ao da planilha GESTOR DE CONTRATOS)

Um contrato por **produto**, controlado por **quantidade** (KG, M³, LT…). Cada contrato tem um livro de
lançamentos; o tipo do lançamento decide qual saldo ele mexe:

| Tipo | Efeito |
|---|---|
| `ENTRADA`, `SOLICITAÇÃO` | consomem o **saldo contratual** |
| `DEVOLUÇÃO` | devolve saldo contratual |
| `LOCAÇÃO` | consome o **saldo de locação** |
| `APLICAÇÃO` / `RECOLHIMENTO` | somam / subtraem o **saldo de aplicação** (cilindros em campo) |
| `REFATURA`, `RECUSA`, `ENTREGA PARCELADA` | informativos, não mexem em saldo |

## O que o dashboard mostra

- **Tempo de contrato**: dias até o término, que correm sozinhos; **saldo contratual**: quantidade contratada
  menos os lançamentos. Mais aplicação, locação e o **status de processo**.
- **Status de processo** (mesma regra da planilha, em `server/calc.js`):

| Aquisição | SOLICITAR PEDIDO | EMITIR NOVA REQ |
|---|---|---|
| Pregão | ≤ 105 dias **ou** saldo ≤ 20% | ≤ 210 dias **ou** saldo ≤ 30% |
| PV | ≤ 45 dias **ou** saldo ≤ 20% | ≤ 90 dias **ou** saldo ≤ 30% |

  Se já há novo processo/requisição em andamento (nº iniciado em 45, 36 ou 30), o alerta é suspenso.
  Diferença deliberada: saldo **zerado** conta como saldo baixo (na planilha, o texto "SEM CONTRATO" fazia um
  contrato zerado com muito prazo aparecer como "-").
- **Solicitações de fornecimento**: emitidas pelo sistema (vários itens do mesmo fornecedor), com a carta pronta
  para imprimir / salvar em PDF. Bloqueia contrato encerrado, avisa "último fornecimento", saldo excedido e
  contrato a ≤ 15 dias do fim. "Lançar entrada" a partir da solicitação já a encerra.

## Importando a planilha atual

*Contratos → Importar planilha…* (ou o botão na tela inicial vazia) lê o `.xlsm` (só as abas necessárias; a
aba "SOLICITAÇÃO DE FORNECIMENTO" de 80 MB é ignorada) e **confere** o saldo contratual, de aplicação e de
locação de cada contrato contra os valores que a planilha mostrava. Com a planilha enviada: 44 contratos,
1.751 lançamentos, 4 solicitações em aberto, 44/44 saldos idênticos, status de processo idêntico em 43/44
(a diferença é a regra acima). Se o sistema já tem dados, a importação pede confirmação para substituí-los.

## Regras de segurança dos dados

- Lançamento que **excede o saldo** (contratual, de locação ou de aplicação) ou repete uma NF só grava com
  confirmação explícita; a checagem é feita dentro de uma transação, então dois usuários lançando juntos não furam o saldo.
- Editar um contrato que outra pessoa alterou nesse meio-tempo é recusado (controle de versão),
  em vez de sobrescrever em silêncio.
- Contrato com lançamentos não pode ser excluído, só arquivado.
- Todo lançamento/edição/exclusão grava **quem fez e quando** (histórico no contrato).
- Valores são guardados em centavos inteiros.
- **Backup**: menu *Arquivo → Fazer backup do banco* (no PC servidor).

## Limites conhecidos

- **Não há login por usuário**: cada pessoa informa o nome ao abrir (aparece no histórico).
  Há um *código de acesso* opcional para o servidor (tela de configuração, ou `CODIGO_ACESSO`).
  O tráfego é HTTP puro — pensado para rede interna confiável; não exponha à internet.
- A planilha vinculava o PDF de cada NF por hiperlink; aqui os PDFs das notas **não** são anexados ainda.
  Há exportação dos lançamentos em CSV.
- O instalador (`npm run dist`) não foi gerado/testado aqui; o app foi testado rodando em Electron.
