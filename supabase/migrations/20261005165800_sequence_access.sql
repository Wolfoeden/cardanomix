-- Needed to preserve the next legacy message ID after importing explicit identities.
grant usage,select,update on all sequences in schema cardanomix to cardanomix_backend;
