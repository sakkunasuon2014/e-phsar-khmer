"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Pause, Play, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.5, 2] as const;

// Only one voice note plays at a time across the whole workspace — starting a
// second one pauses the first, the way every messenger behaves.
let activeAudio: HTMLAudioElement | null = null;

/** `0:07` — voice notes are capped at a minute, so mm:ss is enough. */
export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Playback controls for one voice note: play/pause, a draggable seek bar,
 * elapsed / total time, a playback-speed toggle and (optionally) download.
 *
 * `src` is a blob URL of locally decrypted (or freshly recorded) audio, so
 * nothing here touches the network. `durationMs` is the sender's recorded
 * length — MediaRecorder WebM files report `duration = Infinity`, so the
 * element's own value is used only once the browser has computed it.
 */
export function VoicePlayer({
  src,
  status = "ready",
  durationMs,
  onDownload,
  compact = false,
  className,
}: {
  src: string | null;
  status?: "loading" | "ready" | "error";
  durationMs: number;
  onDownload?: () => void;
  /** Smaller variant for the composer's staged preview. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("Chat");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null);
  const [speedIndex, setSpeedIndex] = useState(0);
  // True while the duration probe below is seeking to the end of the file.
  const probingRef = useRef(false);

  const totalMs = mediaDurationMs ?? durationMs;
  const ready = status === "ready" && src !== null;
  const speed = SPEEDS[speedIndex];

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio && activeAudio === audio) activeAudio = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      if (audio.ended) audio.currentTime = 0;
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }

  function seek(nextMs: number) {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    const clamped = Math.min(Math.max(0, nextMs), totalMs);
    audio.currentTime = clamped / 1000;
    setPositionMs(clamped);
  }

  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;
    audio.playbackRate = speed;
    if (Number.isFinite(audio.duration)) {
      setMediaDurationMs(audio.duration * 1000);
      return;
    }
    // MediaRecorder WebM has no duration header. Seeking far past the end
    // makes the browser scan the file and compute it, which seeking needs.
    probingRef.current = true;
    audio.currentTime = Number.MAX_SAFE_INTEGER;
  }

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;
    if (probingRef.current) {
      probingRef.current = false;
      if (Number.isFinite(audio.duration)) {
        setMediaDurationMs(audio.duration * 1000);
      }
      audio.currentTime = 0;
      return;
    }
    setPositionMs(audio.currentTime * 1000);
  }

  // Show where playback is once it has started; the full length before that.
  const shownMs = playing || positionMs > 0 ? positionMs : totalMs;
  const iconSize = compact ? "size-3.5" : "size-4";

  return (
    <div
      role="group"
      aria-label={t("thread.voiceNote")}
      className={cn(
        "flex max-w-full items-center",
        compact
          ? "w-60 gap-1.5 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-1"
          : "w-64 gap-2 rounded-2xl border border-border bg-muted px-2.5 py-2",
        className,
      )}
    >
      <button
        type="button"
        onClick={togglePlayback}
        disabled={!ready}
        aria-label={playing ? t("voice.pause") : t("voice.play")}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition-colors hover:bg-sky-600 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
          compact ? "size-7" : "size-9",
        )}
      >
        {status === "loading" ? (
          <Loader2 className={cn(iconSize, "animate-spin")} />
        ) : status === "error" ? (
          <TriangleAlert className={iconSize} />
        ) : playing ? (
          <Pause className={cn(iconSize, "fill-current")} />
        ) : (
          <Play className={cn(iconSize, "fill-current")} />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        {status === "error" ? (
          <span className="truncate text-[11px] font-medium">
            {t("message.decryptFailed")}
          </span>
        ) : (
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(totalMs))}
            step={100}
            value={Math.min(Math.round(positionMs), Math.round(totalMs))}
            disabled={!ready}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={t("voice.seek")}
            aria-valuetext={`${formatVoiceDuration(positionMs)} / ${formatVoiceDuration(totalMs)}`}
            className="h-1 w-full cursor-pointer accent-sky-500 disabled:cursor-default"
          />
        )}
        {!compact && status !== "error" && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatVoiceDuration(shownMs)}
          </span>
        )}
      </div>

      {compact && (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatVoiceDuration(shownMs)}
        </span>
      )}

      <button
        type="button"
        onClick={() => setSpeedIndex((i) => (i + 1) % SPEEDS.length)}
        disabled={!ready}
        aria-label={t("voice.speed", { rate: speed })}
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      >
        {speed}×
      </button>

      {onDownload && ready && (
        <button
          type="button"
          onClick={onDownload}
          aria-label={t("message.download")}
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Download className="size-3.5" />
        </button>
      )}

      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setMediaDurationMs(d * 1000);
          }}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPositionMs(0);
          }}
          className="hidden"
        />
      )}
    </div>
  );
}
