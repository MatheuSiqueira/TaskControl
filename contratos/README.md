# Controle de Contratos

Gestão de contratos de entrega parcelada, em rede e com vários usuários ao mesmo tempo.
Substitui a planilha: o **prazo** e o **saldo** de cada contrato aparecem no dashboard e se
atualizam sozinhos — o saldo é debitado a cada nota fiscal lançada e o prazo corre com os dias.

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

## O que o dashboard mostra, por contrato

| Item | Cálculo |
|---|---|
| Tempo de contrato | dias restantes até o **fim vigente** (fim original, ou o da última prorrogação por aditivo) e % do prazo |
| Saldo contratual | valor do contrato (+ aditivos de valor) − soma das notas fiscais |
| Alertas | vence em ≤ 30 dias (crítico) / ≤ 90 (atenção); saldo ≤ 10% (crítico) / ≤ 25% (atenção); saldo excedido ou esgotado; ritmo de consumo que esgota o saldo antes do fim da vigência, ou que deixará sobra |
| Análise de ritmo | consumo médio/mês, valor/mês necessário para usar o saldo, data estimada de esgotamento, sobra projetada |

Limites dos alertas ficam em `server/calc.js` (`LIMITES`).

## Regras de segurança dos dados

- Nota que **excede o saldo** é barrada e só passa com confirmação explícita; a checagem é
  feita dentro de uma transação, então dois usuários lançando juntos não furam o saldo.
- NF com número repetido no mesmo contrato é recusada.
- Editar um contrato que outra pessoa alterou nesse meio-tempo é recusado (controle de versão),
  em vez de sobrescrever em silêncio.
- Contrato com notas não pode ser excluído, só arquivado. Aditivo que deixaria o saldo negativo não entra.
- Todo lançamento/edição/exclusão grava **quem fez e quando** (histórico no contrato).
- Valores são guardados em centavos inteiros.
- **Backup**: menu *Arquivo → Fazer backup do banco* (no PC servidor).

## Limites conhecidos

- **Não há login por usuário**: cada pessoa informa o nome ao abrir (aparece no histórico).
  Há um *código de acesso* opcional para o servidor (tela de configuração, ou `CODIGO_ACESSO`).
  O tráfego é HTTP puro — pensado para rede interna confiável; não exponha à internet.
- Não há importação da planilha antiga ainda (precisa do layout das colunas); existe exportação
  das notas em CSV.
- O instalador (`npm run dist`) não foi gerado/testado aqui; o app foi testado rodando em Electron.
