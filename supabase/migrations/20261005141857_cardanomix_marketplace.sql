-- Separate CardanoMix schema; no changes to game/drip or Supabase Auth.
create schema cardanomix;

-- CardanoMix P2P: Grundschema
-- Beträge sind Ganzzahlen: ADA in Lovelace (1 ADA = 1_000_000), Fiat in Cent,
-- Preise in Mikro-Fiat pro ADA (0,45 EUR = 450_000).

create table cardanomix.users (
  id uuid primary key default gen_random_uuid(),
  -- Stake-Adresse (stake1…) oder bei Wallets ohne Stake-Schlüssel die Enterprise-Adresse
  identity text not null unique,
  -- Adresse, an die dieser Nutzer als Käufer ADA erhält
  receive_address text not null,
  display_name text not null,
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create unique index users_display_name_lower_idx on cardanomix.users (lower(display_name));

create table cardanomix.auth_nonces (
  nonce text primary key,
  message text not null,
  expires_at timestamptz not null
);

create index auth_nonces_expires_idx on cardanomix.auth_nonces (expires_at);

create table cardanomix.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references cardanomix.users (id),
  -- Sicht des Anbieters: sell = verkauft ADA, buy = kauft ADA
  side text not null check (side in ('sell', 'buy')),
  asset text not null default 'ADA' check (asset = 'ADA'),
  fiat text not null check (fiat in ('EUR', 'USD', 'CHF', 'GBP')),
  price_type text not null check (price_type in ('fixed', 'margin')),
  fixed_price_micro bigint check (fixed_price_micro > 0),
  -- Auf- oder Abschlag zum Marktpreis in Basispunkten (150 = +1,5 %)
  margin_bps integer check (margin_bps between -2000 and 2000),
  available_lovelace bigint not null check (available_lovelace >= 0),
  min_fiat_cents bigint not null check (min_fiat_cents > 0),
  max_fiat_cents bigint not null,
  payment_methods text[] not null check (cardinality(payment_methods) > 0),
  terms text not null default '' check (char_length(terms) <= 1000),
  payment_window_min integer not null check (payment_window_min between 15 and 180),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_fiat_cents >= min_fiat_cents),
  check (
    (price_type = 'fixed' and fixed_price_micro is not null)
    or (price_type = 'margin' and margin_bps is not null)
  )
);

create index offers_market_idx on cardanomix.offers (status, side, fiat);
create index offers_user_idx on cardanomix.offers (user_id, created_at desc);

create table cardanomix.trades (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references cardanomix.offers (id),
  maker_id uuid not null references cardanomix.users (id),
  taker_id uuid not null references cardanomix.users (id),
  seller_id uuid not null references cardanomix.users (id),
  buyer_id uuid not null references cardanomix.users (id),
  fiat text not null,
  price_micro bigint not null check (price_micro > 0),
  lovelace bigint not null check (lovelace > 0),
  fiat_cents bigint not null check (fiat_cents > 0),
  payment_method text not null,
  buyer_address text not null,
  status text not null check (status in ('awaiting_payment', 'paid', 'completed', 'cancelled', 'disputed')),
  payment_deadline timestamptz not null,
  tx_hash text unique,
  paid_at timestamptz,
  completed_at timestamptz,
  -- onchain | buyer_confirmed | admin
  completion_note text,
  cancelled_at timestamptz,
  -- buyer_cancelled | expired | admin
  cancel_reason text,
  -- Wer den Abbruch zu verantworten hat; zählt in die Abschlussquote
  cancel_fault_user_id uuid references cardanomix.users (id),
  disputed_at timestamptz,
  disputed_by uuid references cardanomix.users (id),
  dispute_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maker_id <> taker_id),
  check (seller_id <> buyer_id)
);

create index trades_seller_idx on cardanomix.trades (seller_id, created_at desc);
create index trades_buyer_idx on cardanomix.trades (buyer_id, created_at desc);
create index trades_offer_idx on cardanomix.trades (offer_id);
create index trades_status_idx on cardanomix.trades (status, payment_deadline);

create table cardanomix.trade_messages (
  id bigint generated always as identity primary key,
  trade_id uuid not null references cardanomix.trades (id) on delete cascade,
  -- null = Systemnachricht
  sender_id uuid references cardanomix.users (id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index trade_messages_trade_idx on cardanomix.trade_messages (trade_id, id);

create table cardanomix.ratings (
  trade_id uuid not null references cardanomix.trades (id),
  rater_id uuid not null references cardanomix.users (id),
  ratee_id uuid not null references cardanomix.users (id),
  positive boolean not null,
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (trade_id, rater_id)
);

create index ratings_ratee_idx on cardanomix.ratings (ratee_id, created_at desc);

-- PayPal wird als Zahlungsart abgeschafft (Rückbuchungsrisiko, kein Käuferschutz bei „Freunde & Familie“).
-- Angebote nur mit PayPal werden geschlossen (Zahlungsart bleibt für die Historie stehen),
-- bei allen anderen wird PayPal entfernt. Laufende und alte Trades bleiben unverändert.

update cardanomix.offers
set status = 'closed', updated_at = now()
where payment_methods = array['PAYPAL']::text[] and status <> 'closed';

update cardanomix.offers
set payment_methods = array_remove(payment_methods, 'PAYPAL'), updated_at = now()
where 'PAYPAL' = any(payment_methods) and cardinality(payment_methods) > 1;

-- Treuhand für die Krypto-Seite: Der Verkäufer hinterlegt die ADA auf einer Native-Script-Adresse
-- (2 von 3: Verkäufer, Käufer, CardanoMix; oder Verkäufer allein nach Ablauf eines Zeitschlosses).
-- Bestehende Trades behalten den alten Ablauf (escrow = false).

alter table cardanomix.trades add column escrow boolean not null default false;
-- Adresse, an die das Restguthaben (Gebührenpuffer, Rückzahlung) des Verkäufers geht
alter table cardanomix.trades add column seller_address text;
alter table cardanomix.trades add column escrow_address text unique;
-- Native Script als CBOR-Hex, damit jeder die Bedingungen nachprüfen kann
alter table cardanomix.trades add column escrow_script text;
alter table cardanomix.trades add column escrow_refund_slot bigint;
alter table cardanomix.trades add column escrow_refund_after timestamptz;
alter table cardanomix.trades add column escrow_required_lovelace bigint;
alter table cardanomix.trades add column escrow_funded_lovelace bigint;
alter table cardanomix.trades add column escrow_status text
  check (escrow_status in ('pending', 'funded', 'releasing', 'released', 'refunding', 'refunded'));
alter table cardanomix.trades add column escrow_deadline timestamptz;
alter table cardanomix.trades add column escrow_checked_at timestamptz;
alter table cardanomix.trades add column escrow_deposit_tx text;
alter table cardanomix.trades add column payout_kind text check (payout_kind in ('release', 'refund'));
alter table cardanomix.trades add column payout_tx_hash text unique;
alter table cardanomix.trades add column payout_submitted_at timestamptz;
-- Vom Server gebaute, noch nicht signierte Auszahlung (nur diese signiert der Schlichter mit)
alter table cardanomix.trades add column pending_payout_tx text;
alter table cardanomix.trades add column pending_payout_kind text check (pending_payout_kind in ('release', 'refund'));
alter table cardanomix.trades add column pending_payout_signer uuid references cardanomix.users (id);

alter table cardanomix.trades drop constraint trades_status_check;
alter table cardanomix.trades add constraint trades_status_check
  check (status in ('awaiting_escrow', 'awaiting_payment', 'paid', 'completed', 'cancelled', 'disputed'));

create index trades_escrow_open_idx on cardanomix.trades (escrow_status) where escrow;

-- Zahlungsfrist in Minuten; startet bei Treuhand-Trades erst, wenn die Hinterlegung bestätigt ist
alter table cardanomix.trades add column payment_window_min integer;

create table cardanomix.listings (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references cardanomix.users(id),
 title text not null check(char_length(title) between 3 and 120), description text not null check(char_length(description) between 10 and 10000),
 category text not null check(category in ('electronics','home','clothing','collectibles','digital','services','other')),
 type text not null check(type in ('goods','digital','service')), price_lovelace bigint not null check(price_lovelace between 2000000 and 10000000000000),
 shipping_lovelace bigint not null default 0 check(shipping_lovelace between 0 and 10000000000),
 delivery text not null check(delivery in ('shipping','pickup','digital')), condition text not null default '', location text not null default '',
 terms text not null default '', service_scope text not null default '', delivery_days integer not null check(delivery_days between 0 and 365),
 status text not null default 'draft' check(status in ('draft','active','paused','reserved','sold','archived','hidden')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index listings_market_idx on cardanomix.listings(category,created_at desc) where status='active';
create index listings_seller_idx on cardanomix.listings(seller_id,created_at desc);
create table cardanomix.listing_images (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references cardanomix.listings(id),
 owner_id uuid not null references cardanomix.users(id), upload_path text not null unique,
 image_path text, thumbnail_path text, position integer not null check(position between 0 and 9),
 status text not null default 'pending' check(status in ('pending','processing','ready','deleted')),
 created_at timestamptz not null default now()
);
create unique index listing_images_position_idx on cardanomix.listing_images(listing_id,position) where status <> 'deleted';
create table cardanomix.conversations (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references cardanomix.listings(id),
 buyer_id uuid not null references cardanomix.users(id), seller_id uuid not null references cardanomix.users(id),
 updated_at timestamptz not null default now(), unique(listing_id,buyer_id), check(buyer_id<>seller_id)
);
create table cardanomix.messages (
 id bigint generated always as identity primary key, conversation_id uuid not null references cardanomix.conversations(id),
 sender_id uuid not null references cardanomix.users(id), body text not null check(char_length(body) between 1 and 2000), created_at timestamptz not null default now()
);
create index messages_conversation_idx on cardanomix.messages(conversation_id,id);
create table cardanomix.orders (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references cardanomix.listings(id),
 buyer_id uuid not null references cardanomix.users(id), seller_id uuid not null references cardanomix.users(id),
 conversation_id uuid not null references cardanomix.conversations(id), title text not null, description text not null, terms text not null,
 price_lovelace bigint not null check(price_lovelace>=2000000), shipping_lovelace bigint not null check(shipping_lovelace>=0),
 fee_lovelace bigint not null check(fee_lovelace=1000000), seller_address text not null, fee_address text not null,
 delivery text not null, delivery_details text not null default '', fulfillment_note text not null default '', dispute_reason text not null default '',
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','payment_pending','paid','fulfilled','completed','expired','cancelled','disputed')),
 payment_deadline timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(buyer_id<>seller_id)
);
create unique index orders_one_open_idx on cardanomix.orders(listing_id) where status not in ('expired','cancelled');
create index orders_parties_idx on cardanomix.orders(buyer_id,seller_id,created_at desc);
create table cardanomix.order_payments (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references cardanomix.orders(id),
 tx_hash text not null unique check(tx_hash ~ '^[0-9a-f]{64}$'), tx_hex text not null, signed_tx_hex text,
 status text not null default 'prepared' check(status in ('prepared','submitted','confirmed','expired')),
 required_keys jsonb not null, ttl_slot bigint not null, confirmations integer not null default 0,
 last_checked_at timestamptz, created_at timestamptz not null default now()
);
create table cardanomix.reports (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references cardanomix.listings(id),
 reporter_id uuid not null references cardanomix.users(id), reason text not null check(char_length(reason) between 5 and 2000),
 status text not null default 'open' check(status in ('open','resolved')), created_at timestamptz not null default now()
);
create unique index reports_one_open_idx on cardanomix.reports(listing_id,reporter_id) where status='open';

DO $roles$ BEGIN IF NOT EXISTS (select 1 from pg_roles where rolname='cardanomix_backend') THEN CREATE ROLE cardanomix_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $roles$;
revoke all on schema cardanomix from public;
grant usage on schema cardanomix to cardanomix_backend;
grant select,insert,update,delete on all tables in schema cardanomix to cardanomix_backend;
grant usage,select on all sequences in schema cardanomix to cardanomix_backend;
DO $rls$ DECLARE t record; BEGIN
 for t in select tablename from pg_tables where schemaname='cardanomix' loop
  execute format('alter table cardanomix.%I enable row level security',t.tablename);
  execute format('create policy backend_access on cardanomix.%I for all to cardanomix_backend using (true) with check (true)',t.tablename);
 end loop;
 IF EXISTS(select 1 from pg_roles where rolname='anon') THEN REVOKE ALL ON SCHEMA cardanomix FROM anon; END IF;
 IF EXISTS(select 1 from pg_roles where rolname='authenticated') THEN REVOKE ALL ON SCHEMA cardanomix FROM authenticated; END IF;
END $rls$;
DO $storage$ BEGIN IF to_regclass('storage.buckets') IS NOT NULL THEN
 INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('cardanomix-uploads','cardanomix-uploads',false,5242880,ARRAY['image/jpeg','image/png','image/webp']),
 ('cardanomix-images','cardanomix-images',false,5242880,ARRAY['image/webp']);
 END IF; END $storage$;
