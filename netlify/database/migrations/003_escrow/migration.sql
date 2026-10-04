-- Treuhand für die Krypto-Seite: Der Verkäufer hinterlegt die ADA auf einer Native-Script-Adresse
-- (2 von 3: Verkäufer, Käufer, CardanoMix; oder Verkäufer allein nach Ablauf eines Zeitschlosses).
-- Bestehende Trades behalten den alten Ablauf (escrow = false).

alter table trades add column escrow boolean not null default false;
-- Adresse, an die das Restguthaben (Gebührenpuffer, Rückzahlung) des Verkäufers geht
alter table trades add column seller_address text;
alter table trades add column escrow_address text unique;
-- Native Script als CBOR-Hex, damit jeder die Bedingungen nachprüfen kann
alter table trades add column escrow_script text;
alter table trades add column escrow_refund_slot bigint;
alter table trades add column escrow_refund_after timestamptz;
alter table trades add column escrow_required_lovelace bigint;
alter table trades add column escrow_funded_lovelace bigint;
alter table trades add column escrow_status text
  check (escrow_status in ('pending', 'funded', 'releasing', 'released', 'refunding', 'refunded'));
alter table trades add column escrow_deadline timestamptz;
alter table trades add column escrow_checked_at timestamptz;
alter table trades add column escrow_deposit_tx text;
alter table trades add column payout_kind text check (payout_kind in ('release', 'refund'));
alter table trades add column payout_tx_hash text unique;
alter table trades add column payout_submitted_at timestamptz;
-- Vom Server gebaute, noch nicht signierte Auszahlung (nur diese signiert der Schlichter mit)
alter table trades add column pending_payout_tx text;
alter table trades add column pending_payout_kind text check (pending_payout_kind in ('release', 'refund'));
alter table trades add column pending_payout_signer uuid references users (id);

alter table trades drop constraint trades_status_check;
alter table trades add constraint trades_status_check
  check (status in ('awaiting_escrow', 'awaiting_payment', 'paid', 'completed', 'cancelled', 'disputed'));

create index trades_escrow_open_idx on trades (escrow_status) where escrow;

-- Zahlungsfrist in Minuten; startet bei Treuhand-Trades erst, wenn die Hinterlegung bestätigt ist
alter table trades add column payment_window_min integer;
