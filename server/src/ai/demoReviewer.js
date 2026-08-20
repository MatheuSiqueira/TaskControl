import { MAX_IMPROVE_CHARS } from '../lib/files.js';

/**
 * Revisao offline usada quando nao ha ANTHROPIC_API_KEY configurada.
 * Faz apenas verificacoes mecanicas — nao substitui a revisao por IA, e a
 * interface deixa isso explicito para o usuario (provider: 'demo').
 */
export function demoReview({ parsed, filename, task }) {
  const base = {
    provider: 'demo',
    model: 'verificacao-local',
    usage: null,
  };

  if (parsed.kind !== 'text') {
    return {
      ...base,
      score: 0,
      approvedByAi: false,
      summary:
        'O modo demonstração não consegue ler PDFs nem imagens. Configure a ANTHROPIC_API_KEY ' +
        'no arquivo .env para que a IA revise este arquivo de verdade.',
      strengths: [],
      issues: [
        {
          severity: 'alto',
          location: filename,
          problem: 'Arquivo não textual sem revisão de IA disponível.',
          suggestion: 'Defina ANTHROPIC_API_KEY no .env e reinicie o servidor para revisar de verdade.',
        },
      ],
      checklist: [],
      improvedContent: '',
      improvementNotes: '',
    };
  }

  const text = parsed.text;
  const lines = text.split('\n');
  const issues = [];
  const strengths = [];

  if (text.trim().length === 0) {
    issues.push({
      severity: 'critico',
      location: 'arquivo inteiro',
      problem: 'O arquivo está vazio.',
      suggestion: 'Envie o conteúdo da entrega.',
    });
  } else if (text.trim().length < 200) {
    issues.push({
      severity: 'alto',
      location: 'arquivo inteiro',
      problem: `O arquivo tem apenas ${text.trim().length} caracteres — provavelmente está incompleto.`,
      suggestion: 'Desenvolva o conteúdo até cobrir todos os critérios da tarefa.',
    });
  } else {
    strengths.push('O arquivo tem conteúdo suficiente para ser avaliado.');
  }

  lines.forEach((line, i) => {
    const marker = line.match(/\b(TODO|FIXME|XXX|LOREM IPSUM|PREENCHER)\b/i);
    if (marker) {
      issues.push({
        severity: 'alto',
        location: `linha ${i + 1}`,
        problem: `Marcador de pendência "${marker[1]}" deixado no arquivo.`,
        suggestion: 'Substitua o marcador pelo conteúdo final antes de entregar.',
      });
    }
  });

  const longLines = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.length > 300);
  if (longLines.length) {
    issues.push({
      severity: 'baixo',
      location: `linha ${longLines[0].n}${longLines.length > 1 ? ` e mais ${longLines.length - 1}` : ''}`,
      problem: 'Linhas muito longas prejudicam a leitura.',
      suggestion: 'Quebre os parágrafos em linhas menores.',
    });
  }

  const checklist = keywordsFrom(task.fileCriteria).map((word) => {
    const ok = new RegExp(`\\b${escapeRegExp(word)}`, 'i').test(text);
    if (!ok) {
      issues.push({
        severity: 'medio',
        location: 'arquivo inteiro',
        problem: `O critério menciona "${word}", mas essa palavra não aparece no arquivo.`,
        suggestion: `Confirme se o item "${word}" foi realmente coberto na entrega.`,
      });
    }
    return {
      item: `Menciona "${word}"`,
      ok,
      comment: ok ? 'Termo encontrado no arquivo.' : 'Termo não encontrado no arquivo.',
    };
  });

  const penalty = { critico: 40, alto: 20, medio: 8, baixo: 3 };
  const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + penalty[i.severity], 0));

  const improved = text.length <= MAX_IMPROVE_CHARS ? tidy(text) : '';
  const changed = improved && improved !== text;

  return {
    ...base,
    score,
    approvedByAi: !issues.some((i) => i.severity === 'critico' || i.severity === 'alto'),
    summary:
      'Modo demonstração: apenas verificações mecânicas foram feitas (marcadores pendentes, ' +
      'tamanho, formatação e presença dos termos dos critérios). Configure a ANTHROPIC_API_KEY ' +
      'no .env para receber a revisão completa da IA.',
    strengths,
    issues,
    checklist,
    improvedContent: changed ? improved : '',
    improvementNotes: changed
      ? 'Espaços em branco no fim das linhas removidos, linhas em branco repetidas colapsadas e quebra de linha final garantida.'
      : '',
  };
}

/** Limpeza puramente mecanica — nao altera o sentido do texto. */
function tidy(text) {
  return `${text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

const STOPWORDS = new Set([
  'deve', 'conter', 'devem', 'verifique', 'arquivo', 'relatorio', 'relatório', 'entre',
  'sobre', 'para', 'como', 'esta', 'está', 'sejam', 'todas', 'todos', 'cada', 'ainda',
  'exemplo', 'inclua', 'aponte', 'trechos', 'exatos', 'precisam', 'falta', 'antes',
  'depois', 'forma', 'clara', 'sem', 'com', 'que', 'uma', 'dos', 'das', 'nos', 'nas',
]);

function keywordsFrom(criteria) {
  if (!criteria) return [];
  const seen = new Set();
  return (criteria.toLowerCase().match(/[a-zà-ú][a-zà-ú]{4,}/g) || [])
    .filter((word) => !STOPWORDS.has(word) && !seen.has(word) && seen.add(word))
    .slice(0, 8);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
