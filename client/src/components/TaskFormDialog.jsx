import { useState } from 'react';

const EMPTY = {
  title: '',
  description: '',
  assignee: '',
  priority: 'media',
  dueDate: '',
  requiresFile: false,
  fileCriteria: '',
  minScore: 75,
};

const CRITERIA_PLACEHOLDER =
  'Ex.: o documento deve ter introdução, tabela com os números do mês, comparativo com o ' +
  'mês anterior e conclusão. Verifique erros de português e contas que não fecham.';

export default function TaskFormDialog({ task, onSubmit, onClose }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(task || {}) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (event) => {
    const value =
      event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      setError('O título da tarefa é obrigatório.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        title: form.title,
        description: form.description,
        assignee: form.assignee,
        priority: form.priority,
        dueDate: form.dueDate,
        requiresFile: form.requiresFile,
        fileCriteria: form.requiresFile ? form.fileCriteria : '',
        minScore: Number(form.minScore) || 70,
      });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="overlay centered" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="dialog-head">
          <h2>{task ? 'Editar tarefa' : 'Nova tarefa'}</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="dialog-body">
          {error && (
            <div className="alert alert-error">
              <span>⚠️</span>
              <div>{error}</div>
            </div>
          )}

          <div className="field">
            <label htmlFor="title">Título *</label>
            <input
              id="title"
              value={form.title}
              onChange={set('title')}
              placeholder="Ex.: Relatório mensal de vendas"
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="description">Descrição</label>
            <textarea
              id="description"
              value={form.description}
              onChange={set('description')}
              placeholder="O que precisa ser feito?"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="assignee">Responsável</label>
              <input id="assignee" value={form.assignee} onChange={set('assignee')} />
            </div>
            <div className="field">
              <label htmlFor="dueDate">Prazo</label>
              <input id="dueDate" type="date" value={form.dueDate} onChange={set('dueDate')} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="priority">Prioridade</label>
            <select id="priority" value={form.priority} onChange={set('priority')}>
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
            </select>
          </div>

          <div className="panel">
            <label className="switch">
              <input type="checkbox" checked={form.requiresFile} onChange={set('requiresFile')} />
              <span>
                <strong>Exigir arquivo com revisão da IA</strong>
              </span>
            </label>
            <p className="hint">
              A tarefa só poderá ser concluída depois que o arquivo for enviado e a IA aprovar a
              entrega.
            </p>

            {form.requiresFile && (
              <div style={{ marginTop: 14 }}>
                <div className="field">
                  <label htmlFor="fileCriteria">Critérios de aceite do arquivo</label>
                  <textarea
                    id="fileCriteria"
                    value={form.fileCriteria}
                    onChange={set('fileCriteria')}
                    placeholder={CRITERIA_PLACEHOLDER}
                  />
                  <p className="hint">
                    Quanto mais específico, melhor o parecer. É isso que a IA usa como checklist.
                  </p>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="minScore">Nota mínima para aprovar: {form.minScore}</label>
                  <input
                    id="minScore"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={form.minScore}
                    onChange={set('minScore')}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <span className="spinner" />}
            {task ? 'Salvar alterações' : 'Criar tarefa'}
          </button>
        </div>
      </form>
    </div>
  );
}
