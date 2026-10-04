-- PayPal wird als Zahlungsart abgeschafft (Rückbuchungsrisiko, kein Käuferschutz bei „Freunde & Familie“).
-- Angebote nur mit PayPal werden geschlossen (Zahlungsart bleibt für die Historie stehen),
-- bei allen anderen wird PayPal entfernt. Laufende und alte Trades bleiben unverändert.

update offers
set status = 'closed', updated_at = now()
where payment_methods = array['PAYPAL']::text[] and status <> 'closed';

update offers
set payment_methods = array_remove(payment_methods, 'PAYPAL'), updated_at = now()
where 'PAYPAL' = any(payment_methods) and cardinality(payment_methods) > 1;
