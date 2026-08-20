import assert from 'node:assert/strict';
import test from 'node:test';

process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
const { reviewFile, hasCredentials } = await import('../src/ai/reviewer.js');

const TASK = {
  title: 'Relatório mensal',
  description: 'Consolidar os números do mês.',
  assignee: 'Comercial',
  minScore: 75,
  fileCriteria: 'Precisa ter tabela de receita e conclusão.',
};

const PARECER = {
  score: 62,
  approved: false,
  summary: 'Falta a tabela de receita.',
  strengths: ['Introdução clara.'],
  issues: [
    { severity: 'baixo', location: 'linha 9', problem: 'Espaçamento irregular.', suggestion: 'Padronize.' },
    { severity: 'critico', location: 'linha 3', problem: 'Tabela de receita ausente.', suggestion: 'Inclua a tabela.' },
    { severity: 'inventado', location: 'linha 5', problem: 'Severidade inválida.', suggestion: 'Cai para médio.' },
  ],
  checklist: [{ item: 'Tem tabela de receita', ok: false, comment: 'Não encontrada.' }],
  improvedContent: '# Relatório\n\n| Produto | Receita |\n',
  improvementNotes: 'Tabela adicionada.',
};

/** Monta uma resposta SSE da Messages API com o JSON do parecer. */
function sseResponse(payload, { stopReason = 'end_turn' } = {}) {
  const events = [
    ['message_start', {
      type: 'message_start',
      message: {
        id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1234, output_tokens: 0 },
      },
    }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: JSON.stringify(payload) },
    }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 890 },
    }],
    ['message_stop', { type: 'message_stop' }],
  ];
  const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Troca o fetch global e devolve o corpo enviado a API. */
function captureRequest(response = () => sseResponse(PARECER)) {
  const original = globalThis.fetch;
  const captured = {};
  globalThis.fetch = async (url, init) => {
    captured.url = String(url);
    captured.body = JSON.parse(init.body);
    return response();
  };
  return {
    captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('monta a requisição no formato esperado pela Messages API', async () => {
  const { captured, restore } = captureRequest();
  try {
    await reviewFile({
      buffer: Buffer.from('# Relatório\nlinha dois\n'),
      filename: 'relatorio.md',
      mimetype: 'text/markdown',
      task: TASK,
    });
  } finally {
    restore();
  }

  assert.match(captured.url, /\/v1\/messages$/);
  assert.equal(captured.body.model, 'claude-opus-5');
  assert.equal(captured.body.stream, true);
  assert.deepEqual(captured.body.thinking, { type: 'adaptive' });
  assert.equal(captured.body.output_config.effort, 'high');
  assert.equal(captured.body.output_config.format.type, 'json_schema');
  assert.equal(captured.body.output_config.format.schema.type, 'object');

  const text = captured.body.messages[0].content[0].text;
  assert.match(text, /Relatório mensal/);
  assert.match(text, /tabela de receita e conclusão/);
  assert.match(text, /1 \| # Relatório/, 'o conteúdo deve ir numerado por linha');
});

test('normaliza o parecer: ordena por severidade e corrige valores inválidos', async () => {
  const { restore } = captureRequest();
  let result;
  try {
    result = await reviewFile({
      buffer: Buffer.from('conteudo do relatorio'),
      filename: 'relatorio.md',
      mimetype: 'text/markdown',
      task: TASK,
    });
  } finally {
    restore();
  }

  assert.equal(result.provider, 'anthropic');
  assert.equal(result.score, 62);
  assert.equal(result.approvedByAi, false);
  assert.deepEqual(
    result.issues.map((i) => i.severity),
    ['critico', 'medio', 'baixo'],
    'os problemas mais graves vêm primeiro e a severidade inválida vira "medio"',
  );
  assert.equal(result.improvedContent, PARECER.improvedContent);
  assert.equal(result.improvementNotes, 'Tabela adicionada.');
  assert.equal(result.usage.inputTokens, 1234);
  assert.equal(result.usage.outputTokens, 890);
});

test('PDF vai como bloco document e não recebe versão melhorada', async () => {
  const { captured, restore } = captureRequest();
  let result;
  try {
    result = await reviewFile({
      buffer: Buffer.from('%PDF-1.4 conteudo'),
      filename: 'contrato.pdf',
      mimetype: 'application/pdf',
      task: TASK,
    });
  } finally {
    restore();
  }

  const [first, second] = captured.body.messages[0].content;
  assert.equal(first.type, 'document');
  assert.equal(first.source.media_type, 'application/pdf');
  assert.equal(first.source.type, 'base64');
  assert.equal(second.type, 'text');
  assert.equal(result.improvedContent, '', 'não dá para reescrever um PDF');
});

test('imagem vai como bloco image', async () => {
  const { captured, restore } = captureRequest();
  try {
    await reviewFile({
      buffer: Buffer.from('png-bytes'),
      filename: 'print.png',
      mimetype: 'image/png',
      task: TASK,
    });
  } finally {
    restore();
  }
  assert.equal(captured.body.messages[0].content[0].type, 'image');
  assert.equal(captured.body.messages[0].content[0].source.media_type, 'image/png');
});

test('recusa da IA vira erro 422 com mensagem legível', async () => {
  const { restore } = captureRequest(() => sseResponse(PARECER, { stopReason: 'refusal' }));
  try {
    await assert.rejects(
      reviewFile({
        buffer: Buffer.from('texto'),
        filename: 'a.md',
        mimetype: 'text/markdown',
        task: TASK,
      }),
      (err) => err.statusCode === 422 && /recusou/i.test(err.message),
    );
  } finally {
    restore();
  }
});

test('arquivo binário é recusado antes de chamar a API', async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return sseResponse(PARECER);
  };
  try {
    await assert.rejects(
      reviewFile({
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x00]),
        filename: 'arquivo.bin',
        mimetype: 'application/octet-stream',
        task: TASK,
      }),
      (err) => err.statusCode === 415,
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(called, false, 'não deve gastar chamada de API com arquivo que não sabe ler');
});

test('sem credencial cai no modo demonstração, sem chamar a API', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(hasCredentials(), false);

  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return sseResponse(PARECER);
  };
  try {
    const result = await reviewFile({
      buffer: Buffer.from('# Doc\n\nTODO: terminar isso\n'),
      filename: 'doc.md',
      mimetype: 'text/markdown',
      task: TASK,
    });
    assert.equal(result.provider, 'demo');
    assert.ok(result.issues.some((i) => /TODO/i.test(i.problem)));
  } finally {
    globalThis.fetch = original;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
  }
  assert.equal(called, false);
});
