import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { TRADE_STATUS_LABEL, type TradeStatus } from "../../shared/constants";
import type { PublicUser, TradeParty } from "../../shared/types";
import { errorMessage } from "../api";
import { CheckIcon, CloseIcon, CopyIcon } from "./Icons";

export function Spinner({ label = "Lädt …" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <span>{errorMessage(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function CopyButton({ value, label = "Kopieren" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
      <span>{copied ? "Kopiert" : label}</span>
    </button>
  );
}

export function StatusBadge({ status }: { status: TradeStatus }) {
  return <span className={`status status-${status}`}>{TRADE_STATUS_LABEL[status]}</span>;
}

function initials(name: string): string {
  return name.replace(/^Trader-/, "").slice(0, 2).toUpperCase();
}

function hue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

export function Avatar({ user, size = 36 }: { user: Pick<TradeParty, "id" | "displayName">; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue(user.id)} 55% 42%)` }}
      aria-hidden="true"
    >
      {initials(user.displayName)}
    </span>
  );
}

export function TraderLine({ user, link = true }: { user: PublicUser; link?: boolean }) {
  const { stats } = user;
  const rated = stats.positiveRatings + stats.negativeRatings;
  return (
    <div className="trader">
      <Avatar user={user} />
      <div className="trader-text">
        {link ? (
          <Link to={`/nutzer/${user.id}`} className="trader-name">
            {user.displayName}
          </Link>
        ) : (
          <span className="trader-name">{user.displayName}</span>
        )}
        <span className="trader-stats">
          {stats.completedTrades} {stats.completedTrades === 1 ? "Trade" : "Trades"}
          {stats.completionRate != null && <> · {Math.round(stats.completionRate * 100)} % abgeschlossen</>}
          {rated > 0 && <> · {Math.round((stats.positiveRatings / rated) * 100)} % positiv</>}
          {stats.completedTrades === 0 && <> · neu</>}
        </span>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function shortAddress(address: string): string {
  return address.length > 24 ? `${address.slice(0, 14)}…${address.slice(-8)}` : address;
}

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatMonth = (iso: string) => dateOnly.format(new Date(iso));

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "abgelaufen";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
