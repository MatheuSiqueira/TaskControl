/** Schema do parecer da revisao — usado como structured output da API da Anthropic. */
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: 'Nota de 0 a 100 para a qualidade do arquivo frente aos critérios.',
    },
    approved: {
      type: 'boolean',
      description: 'true apenas se o arquivo atende a todos os critérios obrigatórios.',
    },
    summary: {
      type: 'string',
      description: 'Resumo do parecer em 2 a 4 frases, em português do Brasil.',
    },
    strengths: {
      type: 'array',
      description: 'Pontos que já estão bons no arquivo.',
      items: { type: 'string' },
    },
    issues: {
      type: 'array',
      description: 'Problemas encontrados, do mais grave para o menos grave.',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critico', 'alto', 'medio', 'baixo'] },
          location: {
            type: 'string',
            description: 'Onde está o problema: número da linha, seção, página ou trecho citado.',
          },
          problem: { type: 'string', description: 'O que está errado.' },
          suggestion: { type: 'string', description: 'Como corrigir, de forma concreta.' },
        },
        required: ['severity', 'location', 'problem', 'suggestion'],
        additionalProperties: false,
      },
    },
    checklist: {
      type: 'array',
      description: 'Um item para cada critério exigido pela tarefa.',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'O critério avaliado.' },
          ok: { type: 'boolean', description: 'true se o arquivo cumpre esse critério.' },
          comment: { type: 'string', description: 'Justificativa curta.' },
        },
        required: ['item', 'ok', 'comment'],
        additionalProperties: false,
      },
    },
    improvedContent: {
      type: 'string',
      description:
        'Conteúdo completo do arquivo já corrigido, pronto para substituir o original. ' +
        'String vazia se não for possível reescrever (PDF, imagem ou arquivo muito grande).',
    },
    improvementNotes: {
      type: 'string',
      description: 'O que foi alterado na versão melhorada. String vazia se não houve reescrita.',
    },
  },
  required: [
    'score',
    'approved',
    'summary',
    'strengths',
    'issues',
    'checklist',
    'improvedContent',
    'improvementNotes',
  ],
  additionalProperties: false,
};
