import { useRef, useState } from "react";

import { formatBytes, formatClock } from "../format";

interface SlotProps {
  accept: string;
  file: File | null;
  disabled: boolean;
  onFile: (file: File) => void;
  label: string;
  meta: string;
  children: React.ReactNode;
}

function Slot({ accept, file, disabled, onFile, label, meta, children }: SlotProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const picked = list?.[0];
    if (picked) onFile(picked);
  };

  const open = () => {
    if (!disabled) input.current?.click();
  };

  return (
    <div
      className={`slot ${over ? "slot--over" : ""} ${file ? "slot--filled" : ""}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      {children}
      <div className="slot__text">
        <div className="slot__name" title={file?.name}>
          {file?.name ?? label}
        </div>
        <div className="slot__meta">{meta}</div>
      </div>
      <span className="slot__action">{file ? "Swap" : "Browse"}</span>
    </div>
  );
}

interface Props {
  image: File | null;
  audio: File | null;
  coverUrl: string | null;
  coverSize: string;
  duration: number | null;
  probing: boolean;
  fps: number;
  accepts: { image: string; audio: string };
  disabled: boolean;
  onImage: (file: File) => void;
  onAudio: (file: File) => void;
}

export function SourcePanel({
  image,
  audio,
  coverUrl,
  coverSize,
  duration,
  probing,
  fps,
  accepts,
  disabled,
  onImage,
  onAudio,
}: Props) {
  const both = image && audio;
  const status = both ? "Ready" : image || audio ? "1 of 2" : "Empty";

  const audioMeta = audio
    ? `${formatBytes(audio.size)} · ${
        duration
          ? `${Math.round(duration * fps).toLocaleString()} frames`
          : probing
            ? "reading…"
            : "length unknown"
      }`
    : "wav / flac / mp3 · 44.1 kHz";

  return (
    <section className="rail__block">
      <div className="rail__head">
        <h2 className="rail__title">01 · Source</h2>
        <span className="rail__status">{status}</span>
      </div>

      <div className="slots">
        <Slot
          accept={accepts.image}
          file={image}
          disabled={disabled}
          onFile={onImage}
          label="Artwork"
          meta={
            image
              ? `${formatBytes(image.size)}${coverSize ? ` · ${coverSize}` : ""}`
              : "jpg / png · 1400px or larger"
          }
        >
          <div className="slot__thumb">
            {coverUrl ? (
              <img src={coverUrl} alt="" />
            ) : (
              <span className="slot__placeholder">Cover</span>
            )}
          </div>
        </Slot>

        <Slot
          accept={accepts.audio}
          file={audio}
          disabled={disabled}
          onFile={onAudio}
          label="Master"
          meta={audioMeta}
        >
          <div className={`slot__clock ${duration ? "slot__clock--on" : ""}`}>
            {duration ? formatClock(duration) : "—"}
          </div>
        </Slot>
      </div>
    </section>
  );
}
