import { useRef, useState } from 'react';

export default function Uploader({ onFile, disabled, label }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function pick(fileList) {
    const file = fileList?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <div className="dropzone-icon">📤</div>
      <p>{label || 'Arraste o arquivo aqui ou clique para escolher'}</p>
      <small>Texto (.md, .txt, .csv, .json, código), PDF ou imagem · até 20 MB</small>
      <input
        ref={inputRef}
        type="file"
        hidden
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
