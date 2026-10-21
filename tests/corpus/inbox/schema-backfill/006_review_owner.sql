ALTER TABLE documents ADD COLUMN owner_login TEXT;
UPDATE documents SET owner_login = 'fixture-owner' WHERE owner_login IS NULL;
CREATE INDEX documents_owner ON documents(owner_login);
