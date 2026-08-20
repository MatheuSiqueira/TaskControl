import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import TaskCard from './components/TaskCard.jsx';
import TaskDrawer from './components/TaskDrawer.jsx';
import TaskFormDialog from './components/TaskFormDialog.jsx';
import { COLUMNS } from './lib/format.js';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState({ aiEnabled: false, model: '' });
  const [search, setSearch] = useState('');
  const [onlyFileTasks, setOnlyFileTasks] = useState(false);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [formTask, setFormTask] = useState(null); // objeto = edicao, 'new' = criacao
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 5200);
  }, []);

  useEffect(() => {
    Promise.all([api.listTasks(), api.health()])
      .then(([taskData, healthData]) => {
        setTasks(taskData.tasks);
        setHealth(healthData);
      })
      .catch((error) => notify(error.message, 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (formTask) setFormTask(null);
      else if (openTaskId) setOpenTaskId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formTask, openTaskId]);

  const upsert = useCallback((task) => {
    setTasks((prev) => {
      const index = prev.findIndex((t) => t.id === task.id);
      if (index === -1) return [task, ...prev];
      const next = [...prev];
      next[index] = task;
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (onlyFileTasks && !task.requiresFile) return false;
      if (!term) return true;
      return [task.title, task.description, task.assignee]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term));
    });
  }, [tasks, search, onlyFileTasks]);

  const openTask = tasks.find((t) => t.id === openTaskId) || null;

  const stats = useMemo(
    () => ({
      total: tasks.length,
      awaitingReview: tasks.filter(
        (t) => t.requiresFile && ['aguardando_arquivo', 'aguardando_revisao'].includes(t.deliveryState),
      ).length,
      blocked: tasks.filter(
        (t) => t.requiresFile && t.status !== 'concluida' && !t.canComplete,
      ).length,
      done: tasks.filter((t) => t.status === 'concluida').length,
    }),
    [tasks],
  );

  async function handleSubmitForm(data) {
    if (formTask === 'new') {
      const { task } = await api.createTask(data);
      upsert(task);
      setFormTask(null);
      setOpenTaskId(task.id);
      notify('Tarefa criada.');
    } else {
      const { task } = await api.updateTask(formTask.id, data);
      upsert(task);
      setFormTask(null);
      notify('Tarefa atualizada.');
    }
  }

  async function handleDelete(task) {
    if (!window.confirm(`Excluir a tarefa "${task.title}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await api.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setOpenTaskId(null);
      notify('Tarefa excluída.');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">✅</div>
          <div>
            <h1>TaskControl</h1>
            <p>Tarefas com entrega de arquivo e revisão por IA</p>
          </div>
        </div>

        <div className="stats">
          <span className="stat">
            <b>{stats.total}</b> tarefas
          </span>
          <span className="stat">
            <b>{stats.blocked}</b> bloqueadas
          </span>
          <span className="stat">
            <b>{stats.awaitingReview}</b> aguardando IA
          </span>
          <span className="stat">
            <b>{stats.done}</b> concluídas
          </span>
        </div>

        <span
          className={`ai-badge ${health.aiEnabled ? 'on' : 'off'}`}
          title={
            health.aiEnabled
              ? `Revisão feita por ${health.model}`
              : 'Configure ANTHROPIC_API_KEY no .env para ativar a revisão por IA'
          }
        >
          {health.aiEnabled
            ? `🤖 IA ativa · ${health.model}`
            : health.demo
              ? '🧪 Demonstração'
              : '🧪 IA em modo demonstração'}
        </span>

        <button type="button" className="btn btn-primary" onClick={() => setFormTask('new')}>
          + Nova tarefa
        </button>
      </header>

      <main className="main">
        {health.demo && (
          <div className="alert alert-info" style={{ marginBottom: 18 }}>
            <span>👋</span>
            <div>
              <strong>Esta é uma demonstração do TaskControl</strong>
              A interface, a trava de conclusão, o versionamento e o ciclo de melhoria são os
              reais — rodando aqui dentro do navegador. O que não roda é a chamada à API da
              Anthropic: esta página não fala com a API, então a revisão usa a verificação local.
              A tarefa <em>Relatório mensal de vendas</em> já vem com um parecer de exemplo no
              formato exato que o <code>claude-opus-5</code> devolve.{' '}
              <a
                href="https://github.com/MatheuSiqueira/TaskControl/tree/claude/task-control-ai-review-1hetu5"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                Código completo no GitHub
              </a>
              .
            </div>
          </div>
        )}

        <div className="toolbar">
          <div className="search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, descrição ou responsável"
            />
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={onlyFileTasks}
              onChange={(e) => setOnlyFileTasks(e.target.checked)}
            />
            <span>Só tarefas com arquivo</span>
          </label>
        </div>

        {loading ? (
          <div className="empty-state">
            <span className="spinner" style={{ margin: '0 auto 12px' }} />
            <p>Carregando tarefas…</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <h3>Nenhuma tarefa por aqui</h3>
            <p>Crie a primeira tarefa para começar.</p>
          </div>
        ) : (
          <div className="board">
            {COLUMNS.map((column) => {
              const columnTasks = filtered.filter((t) => t.status === column.id);
              return (
                <section className="column" key={column.id}>
                  <div className="column-head">
                    <span className="column-dot" style={{ background: column.color }} />
                    <h3>{column.label}</h3>
                    <span className="count">{columnTasks.length}</span>
                  </div>

                  {columnTasks.length === 0 ? (
                    <div className="column-empty">Nada aqui</div>
                  ) : (
                    columnTasks.map((task) => (
                      <TaskCard key={task.id} task={task} onOpen={(t) => setOpenTaskId(t.id)} />
                    ))
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {openTask && (
        <TaskDrawer
          task={openTask}
          aiEnabled={health.aiEnabled}
          demoMode={Boolean(health.demo)}
          onChange={upsert}
          onClose={() => setOpenTaskId(null)}
          onEdit={() => setFormTask(openTask)}
          onDelete={() => handleDelete(openTask)}
          notify={notify}
        />
      )}

      {formTask && (
        <TaskFormDialog
          task={formTask === 'new' ? null : formTask}
          onSubmit={handleSubmitForm}
          onClose={() => setFormTask(null)}
        />
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}
