import Anthropic from '@anthropic-ai/sdk';
import { REVIEW_SCHEMA } from './schema.js';
import { classify, MAX_IMPROVE_CHARS } from '../lib/files.js';
import { demoReview } from './demoReviewer.js';

const MODEL = process.env.REVIEW_MODEL || 'claude-opus-5';

let client = null;
function getClient() {
  if (!client) {
    // O fetch e resolvido a cada chamada (e nao fixado na construcao) para que
    // um fetch global instalado depois — proxy corporativo, teste — continue valendo.
    client = new Anthropic({ fetch: (input, init) => globalThis.fetch(input, init) });
  }
  return client;
}

/** A revisao real so acontece quando ha credencial configurada. */
export function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM_PROMPT = `Você é um revisor sênior, rigoroso e construtivo, que avalia arquivos entregues como parte de uma tarefa de trabalho.

Seu trabalho:
1. Verificar, um a um, se o arquivo cumpre os critérios de aceite informados na tarefa.
2. Encontrar erros reais: informações incorretas ou inconsistentes, contas que não fecham, erros de português, ambiguidades, seções faltando, formatação quebrada, riscos e omissões.
3. Explicar cada problema de forma específica — cite o trecho, a linha, a seção ou a página. Nunca escreva críticas genéricas do tipo "poderia melhorar".
4. Propor a correção concreta para cada problema.
5. Quando o arquivo for texto, entregar em improvedContent a versão completa já corrigida.

Regras da nota:
- 90 a 100: cumpre todos os critérios, sem problemas relevantes.
- 75 a 89: cumpre o essencial, com ajustes pequenos.
- 50 a 74: falta algo importante ou há erros que precisam de correção antes da entrega.
- 0 a 49: não atende à tarefa.
Marque approved como true apenas se nenhum problema de severidade "critico" ou "alto" tiver sobrado.

Regras da versão melhorada (improvedContent):
- Devolva o arquivo INTEIRO já corrigido, no mesmo formato do original — não devolva só um trecho, não use "..." e não envolva o conteúdo em blocos de código markdown que não existiam no original.
- Corrija o que você mesmo apontou, preserve o conteúdo e a intenção do autor, e não invente dados que não existem no original. Se um dado estiver faltando, deixe um marcador visível como [PREENCHER: receita de março].
- Se o arquivo não for texto (PDF ou imagem) ou se for grande demais para reescrever, devolva string vazia em improvedContent e em improvementNotes.

Escreva todo o parecer em português do Brasil.`;

/**
 * Revisa um arquivo com a IA e devolve o parecer estruturado.
 * @returns {Promise<object>} parecer normalizado
 */
export async function reviewFile({ buffer, filename, mimetype, task }) {
  const parsed = classify(buffer, filename, mimetype);
  if (parsed.kind === 'unsupported') {
    const err = new Error(parsed.reason);
    err.statusCode = 415;
    throw err;
  }

  if (!hasCredentials()) {
    return demoReview({ parsed, filename, task });
  }

  const canImprove = parsed.kind === 'text' && parsed.text.length <= MAX_IMPROVE_CHARS;
  const content = buildContent({ parsed, buffer, filename, task, canImprove });

  let message;
  try {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: REVIEW_SCHEMA },
      },
    });
    message = await stream.finalMessage();
  } catch (error) {
    throw toFriendlyError(error);
  }

  if (message.stop_reason === 'refusal') {
    const err = new Error(
      'A IA recusou revisar este arquivo por motivos de segurança' +
        (message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'),
    );
    err.statusCode = 422;
    throw err;
  }

  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    const err = new Error('A IA não retornou um parecer legível. Tente revisar novamente.');
    err.statusCode = 502;
    throw err;
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    const err = new Error('O parecer da IA veio em formato inválido. Tente revisar novamente.');
    err.statusCode = 502;
    throw err;
  }

  return normalize(raw, {
    provider: 'anthropic',
    model: message.model || MODEL,
    canImprove,
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    },
  });
}

function buildContent({ parsed, buffer, filename, task, canImprove }) {
  const criteria = task.fileCriteria?.trim()
    ? task.fileCriteria.trim()
    : 'Nenhum critério específico foi definido. Avalie clareza, correção, completude e formatação.';

  const briefing =
    `# Tarefa\n` +
    `Título: ${task.title}\n` +
    `Descrição: ${task.description || '(sem descrição)'}\n` +
    `Responsável: ${task.assignee || '(não informado)'}\n` +
    `Nota mínima para aprovar: ${task.minScore}\n\n` +
    `# Critérios de aceite do arquivo\n${criteria}\n\n` +
    `# Arquivo entregue\n` +
    `Nome: ${filename}\n` +
    (canImprove
      ? 'Este arquivo é texto: devolva a versão corrigida completa em improvedContent.\n'
      : 'Este arquivo NÃO pode ser reescrito: devolva improvedContent e improvementNotes como string vazia.\n');

  if (parsed.kind === 'text') {
    return [
      {
        type: 'text',
        text:
          `${briefing}\nO conteúdo do arquivo vem abaixo, com o número de cada linha à esquerda ` +
          `para você citar as linhas no campo location. Os números NÃO fazem parte do arquivo e ` +
          `não devem aparecer em improvedContent.\n\n` +
          `<<<ARQUIVO>>>\n${numberLines(parsed.text)}\n<<<FIM DO ARQUIVO>>>`,
      },
    ];
  }

  if (parsed.kind === 'pdf') {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: buffer.toString('base64'),
        },
      },
      { type: 'text', text: briefing },
    ];
  }

  return [
    {
      type: 'image',
      source: { type: 'base64', media_type: parsed.mediaType, data: buffer.toString('base64') },
    },
    { type: 'text', text: briefing },
  ];
}

function numberLines(text) {
  const lines = text.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`).join('\n');
}

const SEVERITIES = new Set(['critico', 'alto', 'medio', 'baixo']);
const ORDER = { critico: 0, alto: 1, medio: 2, baixo: 3 };

function normalize(raw, { provider, model, canImprove, usage }) {
  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((i) => ({
      severity: SEVERITIES.has(i?.severity) ? i.severity : 'medio',
      location: String(i?.location || '—'),
      problem: String(i?.problem || ''),
      suggestion: String(i?.suggestion || ''),
    }))
    .filter((i) => i.problem)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  const improved = canImprove && typeof raw.improvedContent === 'string' ? raw.improvedContent : '';

  return {
    provider,
    model,
    score: clampScore(raw.score),
    approvedByAi: Boolean(raw.approved),
    summary: String(raw.summary || '').trim(),
    strengths: (Array.isArray(raw.strengths) ? raw.strengths : []).map(String).filter(Boolean),
    issues,
    checklist: (Array.isArray(raw.checklist) ? raw.checklist : [])
      .map((c) => ({
        item: String(c?.item || ''),
        ok: Boolean(c?.ok),
        comment: String(c?.comment || ''),
      }))
      .filter((c) => c.item),
    improvedContent: improved.trim() ? improved : '',
    improvementNotes: improved.trim() ? String(raw.improvementNotes || '') : '',
    usage: usage || null,
  };
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toFriendlyError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    const e = new Error('Credencial da Anthropic inválida. Confira a ANTHROPIC_API_KEY no .env.');
    e.statusCode = 502;
    return e;
  }
  if (error instanceof Anthropic.RateLimitError) {
    const e = new Error('Limite de uso da API atingido. Aguarde alguns instantes e tente de novo.');
    e.statusCode = 429;
    return e;
  }
  if (error instanceof Anthropic.BadRequestError) {
    const e = new Error(`A API recusou a requisição: ${error.message}`);
    e.statusCode = 400;
    return e;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    const e = new Error('Não foi possível falar com a API da Anthropic. Verifique a conexão.');
    e.statusCode = 503;
    return e;
  }
  if (error instanceof Anthropic.APIError) {
    const e = new Error(`Erro da API da Anthropic (${error.status}): ${error.message}`);
    e.statusCode = 502;
    return e;
  }
  return error;
}
