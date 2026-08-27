import { useRef, useState } from "react";

import { formatBytes } from "../format";

interface Props {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
  children?: React.ReactNode;
}

export function FileDrop({ label, hint, accept, file, onFile, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const picked = list?.[0];
    if (picked) onFile(picked);
  };

  return (
    <div
      className={`drop ${over ? "drop--over" : ""} ${file ? "drop--filled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") input.current?.click();
      }}
      role="button"
      tabIndex={0}
      aria-label={label}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => take(e.target.files)}
      />
      <div className="drop__label">{label}</div>
      {file ? (
        <div className="drop__body">
          {children}
          <div className="drop__meta">
            <span className="drop__name" title={file.name}>
              {file.name}
            </span>
            <span className="drop__size">{formatBytes(file.size)}</span>
          </div>
          <button
            type="button"
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
              if (input.current) input.current.value = "";
            }}
          >
            remove
          </button>
        </div>
      ) : (
        <div className="drop__body drop__body--empty">
          <div className="drop__hint">{hint}</div>
          <div className="drop__sub">drop it here, or click to browse</div>
        </div>
      )}
    </div>
  );
}
