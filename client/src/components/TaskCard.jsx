import { DELIVERY_LABEL, PRIORITY_LABEL, formatDate, isOverdue } from '../lib/format.js';

export default function TaskCard({ task, onOpen }) {
  const delivery = task.requiresFile ? DELIVERY_LABEL[task.deliveryState] : null;
  const late = isOverdue(task);

  return (
    <button type="button" className="card" onClick={() => onOpen(task)}>
      <div className="card-title">{task.title}</div>
      {task.description && <p className="card-desc">{task.description}</p>}

      <div className="card-meta">
        <span className={`chip chip-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        {delivery && (
          <span className={`chip ${delivery.className}`}>
            {delivery.icon} {delivery.text}
          </span>
        )}
        {task.assignee && <span>👤 {task.assignee}</span>}
        {task.dueDate && (
          <span className={late ? 'overdue' : undefined}>
            {late ? '⏰' : '📅'} {formatDate(task.dueDate)}
          </span>
        )}
      </div>
    </button>
  );
}
