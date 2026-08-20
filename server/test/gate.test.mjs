import assert from 'node:assert/strict';
import test from 'node:test';
import { completionBlockers, deliveryState, serializeTask } from '../src/lib/gate.js';

function task(overrides = {}) {
  return {
    id: 't1',
    title: 'Tarefa',
    description: '',
    assignee: '',
    priority: 'media',
    dueDate: '',
    status: 'em_andamento',
    requiresFile: true,
    fileCriteria: 'Precisa ter conclusão.',
    minScore: 75,
    deliverable: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function deliverable(currentVersion, reviews) {
  return {
    originalName: 'doc.md',
    mime: 'text/markdown',
    currentVersion,
    versions: Array.from({ length: currentVersion }, (_, i) => ({
      version: i + 1,
      storedName: `t1-v${i + 1}-doc.md`,
      originalName: 'doc.md',
      mime: 'text/markdown',
      size: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      source: 'upload',
    })),
    reviews,
  };
}

const review = (over = {}) => ({
  id: 'r1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  provider: 'anthropic',
  model: 'claude-opus-5',
  score: 90,
  minScore: 75,
  approvedByAi: true,
  summary: '',
  strengths: [],
  issues: [],
  checklist: [],
  improvementNotes: '',
  improvedFile: null,
  usage: null,
  ...over,
});

test('tarefa sem exigência de arquivo pode ser concluída direto', () => {
  const t = task({ requiresFile: false });
  assert.deepEqual(completionBlockers(t), []);
  assert.equal(deliveryState(t), 'nao_exige_arquivo');
});

test('bloqueia enquanto nenhum arquivo foi enviado', () => {
  const t = task();
  assert.equal(completionBlockers(t).length, 1);
  assert.match(completionBlockers(t)[0], /nada foi enviado/);
  assert.equal(deliveryState(t), 'aguardando_arquivo');
});

test('bloqueia enquanto o arquivo não passou pela revisão', () => {
  const t = task({ deliverable: deliverable(1, []) });
  assert.match(completionBlockers(t)[0], /não passou pela revisão/);
  assert.equal(deliveryState(t), 'aguardando_revisao');
});

test('bloqueia quando a IA reprovou, citando a nota', () => {
  const t = task({
    deliverable: deliverable(1, [review({ approvedByAi: false, score: 40 })]),
  });
  const blockers = completionBlockers(t);
  assert.match(blockers[0], /nota 40, mínimo exigido 75/);
  assert.equal(deliveryState(t), 'reprovado');
});

test('conta os problemas graves que sobraram', () => {
  const t = task({
    deliverable: deliverable(1, [
      review({
        approvedByAi: false,
        score: 40,
        issues: [
          { severity: 'critico', location: 'l1', problem: 'x', suggestion: 'y' },
          { severity: 'alto', location: 'l2', problem: 'x', suggestion: 'y' },
          { severity: 'baixo', location: 'l3', problem: 'x', suggestion: 'y' },
        ],
      }),
    ]),
  });
  assert.match(completionBlockers(t)[1], /2 problemas graves/);
});

test('libera quando a revisão da versão atual foi aprovada', () => {
  const t = task({ deliverable: deliverable(1, [review()]) });
  assert.deepEqual(completionBlockers(t), []);
  assert.equal(deliveryState(t), 'aprovado');
});

test('uma versão nova sem revisão volta a bloquear a conclusão', () => {
  const t = task({ deliverable: deliverable(2, [review({ version: 1 })]) });
  assert.match(completionBlockers(t)[0], /ainda não foi revisada/);
  assert.equal(deliveryState(t), 'aguardando_revisao');
});

test('vale o parecer mais recente da versão atual', () => {
  const t = task({
    deliverable: deliverable(1, [
      review({ id: 'antigo', approvedByAi: false, score: 30 }),
      review({ id: 'novo', score: 88 }),
    ]),
  });
  assert.deepEqual(completionBlockers(t), []);
});

test('nota abaixo da mínima reprova mesmo com a IA aprovando', () => {
  const t = task({ minScore: 90, deliverable: deliverable(1, [review({ score: 80 })]) });
  assert.match(completionBlockers(t)[0], /nota 80, mínimo exigido 90/);

  // Baixar a exigência da tarefa reavalia o parecer que já existe.
  t.minScore = 75;
  assert.deepEqual(completionBlockers(t), []);
  assert.equal(deliveryState(t), 'aprovado');
});

test('a serialização não vaza caminhos de disco para o navegador', () => {
  const t = task({
    deliverable: deliverable(1, [review({ improvedFile: 'r1-melhorado-doc.md' })]),
  });
  const json = JSON.stringify(serializeTask(t));
  assert.ok(!json.includes('storedName'), 'nome interno do arquivo não deve ir para o cliente');
  assert.ok(!json.includes('improvedFile'), 'caminho da versão melhorada não deve ir para o cliente');
  assert.ok(json.includes('"hasImprovement":true'), 'mas o cliente precisa saber que existe melhoria');
  assert.equal(serializeTask(t).canComplete, true);
});
