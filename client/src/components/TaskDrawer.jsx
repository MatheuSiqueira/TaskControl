import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import ReviewPanel from './ReviewPanel.jsx';
import Uploader from './Uploader.jsx';
import {
  COLUMNS,
  PRIORITY_LABEL,
  formatDate,
  formatDateTime,
  formatSize,
} from '../lib/format.js';

export default function TaskDrawer({ task, aiEnabled, onChange, onClose, onEdit, onDelete, notify }) {
  const [busy, setBusy] = useState(null); // 'upload' | 'review' | 'apply' | 'status'
  const [selectedReviewId, setSelectedReviewId] = useState(null);

  const deliverable = task.deliverable;
  const reviews = useMemo(
    () => (deliverable ? [...deliverable.reviews].reverse() : []),
    [deliverable],
  );

  // Por padrao mostramos o parecer mais recente da versao atual do arquivo.
  useEffect(() => {
    const preferred =
      reviews.find((r) => r.version === deliverable?.currentVersion) || reviews[0];
    setSelectedReviewId((current) =>
      reviews.some((r) => r.id === current) ? current : (preferred?.id ?? null),
    );
  }, [reviews, deliverable?.currentVersion]);

  const selectedReview = reviews.find((r) => r.id === selectedReviewId) || null;
  const staleReview =
    deliverable && selectedReview && selectedReview.version !== deliverable.currentVersion;

  async function runReview(afterMessage) {
    setBusy('review');
    try {
      const { task: updated, review } = await api.review(task.id);
      onChange(updated);
      setSelectedReviewId(review.id);
      notify(
        afterMessage ||
          (review.approved
            ? `Arquivo aprovado pela IA com nota ${review.score}.`
            : `A IA apontou ${review.issues.length} ponto(s) a corrigir.`),
        review.approved ? 'ok' : 'error',
      );
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload(file) {
    setBusy('upload');
    try {
      const { task: updated } = await api.uploadFile(task.id, file);
      onChange(updated);
      setBusy(null);
      await runReview();
    } catch (error) {
      notify(error.message, 'error');
      setBusy(null);
    }
  }

  async function handleApply(reviewId) {
    setBusy('apply');
    try {
      const { task: updated } = await api.applyImprovement(task.id, reviewId);
      onChange(updated);
      setBusy(null);
      await runReview('Versão melhorada aplicada e revisada novamente.');
    } catch (error) {
      notify(error.message, 'error');
      setBusy(null);
    }
  }

  async function changeStatus(status) {
    if (status === task.status) return;
    setBusy('status');
    try {
      const { task: updated } = await api.updateTask(task.id, { status });
      onChange(updated);
      if (status === 'concluida') notify('Tarefa concluída.', 'ok');
    } catch (error) {
      if (error.blockers?.length) {
        if (error.task) onChange(error.task);
        notify(error.blockers.join(' '), 'error');
      } else {
        notify(error.message, 'error');
      }
    } finally {
      setBusy(null);
    }
  }

  const locked = task.requiresFile && !task.canComplete;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{task.title}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
            ✏️ Editar
          </button>
          <button type="button" className="close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="drawer-body">
          <div className="section">
            <div className="section-title">Status</div>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              {COLUMNS.map((col) => {
                const blocked = col.id === 'concluida' && locked;
                return (
                  <button
                    key={col.id}
                    type="button"
                    className={`btn btn-sm${task.status === col.id ? ' btn-primary' : ''}`}
                    onClick={() => changeStatus(col.id)}
                    disabled={busy === 'status' || blocked}
                    title={blocked ? 'Bloqueado até a IA aprovar o arquivo' : undefined}
                  >
                    {blocked && '🔒 '}
                    {col.label}
                  </button>
                );
              })}
            </div>
          </div>

          {locked && (
            <div className="alert alert-warn">
              <span>🔒</span>
              <div>
                <strong>Conclusão bloqueada</strong>
                <ul>
                  {task.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {task.requiresFile && task.canComplete && task.status !== 'concluida' && (
            <div className="alert alert-ok">
              <span>✅</span>
              <div>
                <strong>Liberada para conclusão</strong>
                A IA aprovou o arquivo entregue.
              </div>
            </div>
          )}

          {task.description && (
            <div className="section">
              <div className="section-title">Descrição</div>
              <div className="panel">
                <p className="criteria">{task.description}</p>
              </div>
            </div>
          )}

          <div className="section">
            <div className="section-title">Informações</div>
            <div className="panel">
              <dl className="meta-grid">
                <div>
                  <dt>Responsável</dt>
                  <dd>{task.assignee || '—'}</dd>
                </div>
                <div>
                  <dt>Prazo</dt>
                  <dd>{formatDate(task.dueDate)}</dd>
                </div>
                <div>
                  <dt>Prioridade</dt>
                  <dd>{PRIORITY_LABEL[task.priority]}</dd>
                </div>
                {task.requiresFile && (
                  <div>
                    <dt>Nota mínima</dt>
                    <dd>{task.minScore}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {task.requiresFile ? (
            <>
              {task.fileCriteria && (
                <div className="section">
                  <div className="section-title">Critérios que a IA vai checar</div>
                  <div className="panel">
                    <p className="criteria">{task.fileCriteria}</p>
                  </div>
                </div>
              )}

              <div className="section">
                <div className="section-title">Arquivo da entrega</div>

                {!aiEnabled && (
                  <div className="alert alert-info">
                    <span>ℹ️</span>
                    <div>
                      <strong>Revisão por IA desativada</strong>
                      Defina <code>ANTHROPIC_API_KEY</code> no arquivo <code>.env</code> e reinicie o
                      servidor. Enquanto isso, só rodam verificações mecânicas.
                    </div>
                  </div>
                )}

                {busy === 'upload' ? (
                  <div className="thinking">
                    <span className="spinner" /> Enviando arquivo…
                  </div>
                ) : busy === 'review' ? (
                  <div className="thinking">
                    <span className="spinner" /> A IA está lendo o arquivo e montando o parecer…
                  </div>
                ) : busy === 'apply' ? (
                  <div className="thinking">
                    <span className="spinner" /> Aplicando a versão melhorada pela IA…
                  </div>
                ) : (
                  <Uploader
                    onFile={handleUpload}
                    label={
                      deliverable
                        ? 'Enviar uma nova versão do arquivo'
                        : 'Arraste o arquivo aqui ou clique para escolher'
                    }
                  />
                )}

                {deliverable && (
                  <div style={{ marginTop: 12 }}>
                    {[...deliverable.versions].reverse().map((v) => (
                      <div
                        className={`version${v.version === deliverable.currentVersion ? ' current' : ''}`}
                        key={v.version}
                      >
                        <span>{v.source === 'ia' ? '✨' : '📄'}</span>
                        <span className="version-name">
                          v{v.version} · {v.originalName}
                        </span>
                        <span className="version-info">
                          {v.source === 'ia' && <span className="chip chip-neutral">gerada pela IA</span>}
                          <span>{formatSize(v.size)}</span>
                          <span>{formatDateTime(v.createdAt)}</span>
                          <a
                            className="btn btn-sm btn-ghost"
                            href={api.downloadVersionUrl(task.id, v.version)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ⬇️
                          </a>
                        </span>
                      </div>
                    ))}

                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ marginTop: 10 }}
                      onClick={() => runReview()}
                      disabled={Boolean(busy)}
                    >
                      🤖 Revisar versão atual com a IA
                    </button>
                  </div>
                )}
              </div>

              {selectedReview && (
                <div className="section">
                  <div className="section-title">Parecer da IA</div>
                  {staleReview && (
                    <div className="alert alert-warn">
                      <span>⏳</span>
                      <div>
                        <strong>Parecer desatualizado</strong>
                        Este parecer é da versão {selectedReview.version}, mas o arquivo atual é a
                        versão {deliverable.currentVersion}. Rode a revisão novamente.
                      </div>
                    </div>
                  )}
                  <ReviewPanel
                    review={selectedReview}
                    taskId={task.id}
                    onApply={handleApply}
                    applying={busy === 'apply'}
                    isCurrent={!staleReview}
                  />

                  {reviews.length > 1 && (
                    <div className="section" style={{ marginTop: 14 }}>
                      <div className="section-title">Histórico de revisões</div>
                      {reviews.map((r) => (
                        <button
                          type="button"
                          key={r.id}
                          className={`history-item${r.id === selectedReviewId ? ' active' : ''}`}
                          onClick={() => setSelectedReviewId(r.id)}
                        >
                          <span>{r.approved ? '✅' : '⚠️'}</span>
                          <span>
                            v{r.version} · nota {r.score}
                          </span>
                          <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>
                            {formatDateTime(r.createdAt)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="alert alert-info">
              <span>ℹ️</span>
              <div>
                <strong>Sem entrega de arquivo</strong>
                Esta tarefa pode ser concluída sem envio de arquivo. Edite a tarefa para exigir um
                arquivo com revisão da IA.
              </div>
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
            🗑️ Excluir tarefa
          </button>
          <button
            type="button"
            className="btn btn-ok"
            onClick={() => changeStatus('concluida')}
            disabled={Boolean(busy) || locked || task.status === 'concluida'}
          >
            {locked ? '🔒 Conclusão bloqueada' : '✅ Concluir tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}
