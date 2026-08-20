/**
 * Conteúdo da tarefa de exemplo da demonstração.
 *
 * O parecer abaixo NÃO foi gerado por uma chamada à API dentro da página — a página
 * publicada não fala com a API da Anthropic. Ele foi escrito pelo Claude durante a
 * construção do projeto, no formato exato que o revisor devolve, para mostrar como é
 * a saída real. A interface marca esse parecer como "exemplo".
 */

const arquivo = `# Relatorio de Vendas - Julho

## Resumo
Este relatorio apresenta os numeros de vendas do mes de julho de 2026.
Houveram alguns desafios no periodo, mas os resultados foram positivos.

## Receita por produto

| Produto | Receita |
|---------|---------|
| Plano Basico | R$ 45.000 |
| Plano Pro | R$ 78.500 |
| Plano Enterprise | R$ 120.000 |
| Total | R$ 233.500 |

## Comparativo
O faturamento cresceu 15% em relacao a junho, que fechou em R$ 210.000.

## Observacoes
O time comercial bateu a meta.
`;

const melhorado = `# Relatório de Vendas — Julho de 2026

## Resumo
Este relatório apresenta os números de vendas do mês de julho de 2026.
Houve alguns desafios no período, mas os resultados foram positivos.

## Receita por produto

| Produto | Receita |
|---------|---------|
| Plano Básico | R$ 45.000 |
| Plano Pro | R$ 78.500 |
| Plano Enterprise | R$ 120.000 |
| **Total** | **R$ 243.500** |

## Comparativo com junho
O faturamento cresceu 16,0% em relação a junho, que fechou em R$ 210.000 —
uma diferença de R$ 33.500 no mês.

## Observações
O time comercial bateu a meta do mês, que era de [PREENCHER: meta de julho].

## Conclusão e próximos passos
Julho fechou acima de junho, puxado principalmente pelo Plano Enterprise, que
sozinho respondeu por 49% da receita do mês.

1. Confirmar com o financeiro o valor da meta de julho e registrar o percentual atingido.
2. Entender por que o Plano Básico ficou bem abaixo dos outros dois e propor uma ação para agosto.
3. Refazer o comparativo em 05/08, com os números fechados de agosto.
`;

const parecer = {
  provider: 'exemplo',
  model: 'claude-opus-5',
  score: 58,
  minScore: 75,
  approvedByAi: false,
  summary:
    'O relatório tem a estrutura certa e cobre quase todos os critérios, mas os números não ' +
    'fecham: a linha de total está R$ 10.000 abaixo da soma dos produtos, e o percentual de ' +
    'crescimento não corresponde a nenhum dos dois valores. Falta também a conclusão com ' +
    'próximos passos, que é item obrigatório da tarefa. Com esses três pontos corrigidos, o ' +
    'documento fica pronto para envio.',
  strengths: [
    'A estrutura em seções (resumo, receita, comparativo) está clara e fácil de acompanhar.',
    'A tabela de receita por produto traz os três planos separados, como pedido.',
    'O período analisado está explícito logo no resumo.',
  ],
  issues: [
    {
      severity: 'critico',
      location: 'linha 14',
      problem:
        'O total informado (R$ 233.500) não bate com a soma da tabela: 45.000 + 78.500 + ' +
        '120.000 = R$ 243.500. A diferença é de R$ 10.000.',
      suggestion:
        'Corrija o total para R$ 243.500, ou revise as linhas dos produtos se algum valor ' +
        'estiver errado — mas as duas coisas não podem coexistir no mesmo documento.',
    },
    {
      severity: 'alto',
      location: 'linha 17',
      problem:
        'O crescimento de 15% não corresponde aos números apresentados. Com o total correto ' +
        '(R$ 243.500) sobre R$ 210.000, o crescimento é de 16,0%. Mesmo usando o total errado ' +
        'do documento, daria 11,2% — nenhum dos dois é 15%.',
      suggestion:
        'Use 16,0% e mostre a conta no texto (R$ 243.500 contra R$ 210.000, diferença de ' +
        'R$ 33.500), para o leitor conseguir conferir.',
    },
    {
      severity: 'alto',
      location: 'documento inteiro',
      problem:
        'Falta a conclusão com próximos passos, exigida nos critérios da tarefa. A seção ' +
        '"Observacoes" tem uma frase solta e não cumpre esse papel.',
      suggestion:
        'Acrescente uma seção final com a leitura do mês e 2 a 3 próximos passos com ' +
        'responsável e prazo.',
    },
    {
      severity: 'medio',
      location: 'linha 5',
      problem: '"Houveram alguns desafios" está errado: nesse sentido, o verbo haver é impessoal.',
      suggestion: 'Troque por "Houve alguns desafios no período".',
    },
    {
      severity: 'medio',
      location: 'linha 20',
      problem:
        '"O time comercial bateu a meta" não diz qual era a meta nem por quanto foi batida — ' +
        'quem lê não consegue avaliar o resultado.',
      suggestion:
        'Informe o valor da meta e o percentual atingido. Se o número não estiver à mão, deixe ' +
        'um marcador visível em vez de omitir.',
    },
    {
      severity: 'baixo',
      location: 'todo o texto',
      problem:
        'O documento está sem acentuação ("Relatorio", "numeros", "mes", "relacao", ' +
        '"Observacoes"), o que destoa de um relatório que vai circular.',
      suggestion: 'Revise a acentuação antes do envio.',
    },
  ],
  checklist: [
    { item: 'Tem título', ok: true, comment: 'Título na linha 1, ainda que sem acento.' },
    {
      item: 'Informa o período analisado',
      ok: true,
      comment: 'Julho de 2026, indicado no resumo.',
    },
    {
      item: 'Tem tabela com receita por produto',
      ok: true,
      comment: 'Os três planos aparecem separados, mas a linha de total está incorreta.',
    },
    {
      item: 'Compara com o mês anterior em porcentagem',
      ok: false,
      comment: 'A comparação existe, mas o percentual está errado.',
    },
    {
      item: 'Tem conclusão com próximos passos',
      ok: false,
      comment: 'Ausente.',
    },
  ],
  improvementNotes:
    'Total corrigido para R$ 243.500, crescimento recalculado para 16,0% com a conta explícita, ' +
    'seção de conclusão com três próximos passos adicionada, "Houveram" corrigido para "Houve" e ' +
    'acentuação revisada. A meta de julho, que não estava no original, ficou como marcador ' +
    '[PREENCHER] em vez de ser inventada.',
};

export const EXEMPLO = { arquivo, melhorado, parecer };
