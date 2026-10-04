-- CardanoMix P2P: Grundschema
-- Beträge sind Ganzzahlen: ADA in Lovelace (1 ADA = 1_000_000), Fiat in Cent,
-- Preise in Mikro-Fiat pro ADA (0,45 EUR = 450_000).

create table users (
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

create unique index users_display_name_lower_idx on users (lower(display_name));

create table auth_nonces (
  nonce text primary key,
  message text not null,
  expires_at timestamptz not null
);

create index auth_nonces_expires_idx on auth_nonces (expires_at);

create table offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
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

create index offers_market_idx on offers (status, side, fiat);
create index offers_user_idx on offers (user_id, created_at desc);

create table trades (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers (id),
  maker_id uuid not null references users (id),
  taker_id uuid not null references users (id),
  seller_id uuid not null references users (id),
  buyer_id uuid not null references users (id),
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
  cancel_fault_user_id uuid references users (id),
  disputed_at timestamptz,
  disputed_by uuid references users (id),
  dispute_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maker_id <> taker_id),
  check (seller_id <> buyer_id)
);

create index trades_seller_idx on trades (seller_id, created_at desc);
create index trades_buyer_idx on trades (buyer_id, created_at desc);
create index trades_offer_idx on trades (offer_id);
create index trades_status_idx on trades (status, payment_deadline);

create table trade_messages (
  id bigint generated always as identity primary key,
  trade_id uuid not null references trades (id) on delete cascade,
  -- null = Systemnachricht
  sender_id uuid references users (id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index trade_messages_trade_idx on trade_messages (trade_id, id);

create table ratings (
  trade_id uuid not null references trades (id),
  rater_id uuid not null references users (id),
  ratee_id uuid not null references users (id),
  positive boolean not null,
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (trade_id, rater_id)
);

create index ratings_ratee_idx on ratings (ratee_id, created_at desc);
