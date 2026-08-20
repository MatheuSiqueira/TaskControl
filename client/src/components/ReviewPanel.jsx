import { api } from '../lib/api.js';
import { SEVERITY_LABEL, formatDateTime, scoreColor } from '../lib/format.js';

export default function ReviewPanel({ review, taskId, onApply, applying, isCurrent }) {
  const ring = { '--value': review.score, '--ring': scoreColor(review.score) };

  return (
    <div className="panel">
      <div className="review-head">
        <div className="score-ring" style={ring}>
          <div>
            <div className="score-value" style={{ color: scoreColor(review.score) }}>
              {review.score}
            </div>
            <div className="score-label">de 100</div>
          </div>
        </div>

        <div className="review-verdict">
          <h4 style={{ color: review.approved ? 'var(--ok)' : 'var(--danger)' }}>
            {review.approved ? '✅ Arquivo aprovado' : '⚠️ Arquivo reprovado'}
          </h4>
          <div className="card-meta">
            <span className="chip chip-neutral">versão {review.version}</span>
            <span className="chip chip-neutral">nota mínima {review.minScore}</span>
            <span>{formatDateTime(review.createdAt)}</span>
          </div>
        </div>
      </div>

      {review.provider === 'demo' && (
        <div className="alert alert-warn">
          <span>🧪</span>
          <div>
            <strong>Modo demonstração</strong>
            Sem <code>ANTHROPIC_API_KEY</code> configurada, só rodam verificações mecânicas — não é a
            revisão da IA.
          </div>
        </div>
      )}

      {review.summary && <p className="review-summary">{review.summary}</p>}

      {review.checklist.length > 0 && (
        <div className="section" style={{ marginTop: 18 }}>
          <div className="section-title">Critérios da tarefa</div>
          {review.checklist.map((item, i) => (
            <div className="check-item" key={i}>
              <span className="check-mark">{item.ok ? '✅' : '❌'}</span>
              <div>
                {item.item}
                {item.comment && <small>{item.comment}</small>}
              </div>
            </div>
          ))}
        </div>
      )}

      {review.issues.length > 0 && (
        <div className="section">
          <div className="section-title">
            O que precisa melhorar ({review.issues.length})
          </div>
          {review.issues.map((issue, i) => (
            <div className={`issue sev-${issue.severity}`} key={i}>
              <div className="issue-head">
                <span className={`sev-tag ${issue.severity}`}>
                  {SEVERITY_LABEL[issue.severity]}
                </span>
                <span className="issue-loc">{issue.location}</span>
              </div>
              <p className="issue-problem">{issue.problem}</p>
              {issue.suggestion && <p className="issue-fix">💡 {issue.suggestion}</p>}
            </div>
          ))}
        </div>
      )}

      {review.strengths.length > 0 && (
        <div className="section">
          <div className="section-title">Pontos positivos</div>
          <ul className="list-plain">
            {review.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {review.hasImprovement && (
        <div className="improve-box">
          <h5>✨ A IA já reescreveu o arquivo</h5>
          <p>
            {review.improvementNotes ||
              'Uma versão corrigida do arquivo foi gerada a partir dos problemas apontados acima.'}
          </p>
          <div className="improve-actions">
            <a
              className="btn btn-sm"
              href={api.downloadImprovedUrl(taskId, review.id)}
              target="_blank"
              rel="noreferrer"
            >
              ⬇️ Baixar versão melhorada
            </a>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => onApply(review.id)}
              disabled={applying}
            >
              {applying ? <span className="spinner" /> : '↗️'}
              {applying ? 'Aplicando…' : 'Usar como nova versão'}
            </button>
          </div>
          {!isCurrent && (
            <p className="hint">
              Este parecer é de uma versão anterior do arquivo.
            </p>
          )}
        </div>
      )}

      <p className="hint">
        {review.provider === 'anthropic' ? `Revisado por ${review.model}` : 'Verificação local'}
        {review.usage
          ? ` · ${review.usage.inputTokens.toLocaleString('pt-BR')} tokens de entrada, ${review.usage.outputTokens.toLocaleString('pt-BR')} de saída`
          : ''}
      </p>
    </div>
  );
}
