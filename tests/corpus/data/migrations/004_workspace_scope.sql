-- Intentional fixture defects: required column without backfill; destructive cleanup.
ALTER TABLE documents ADD COLUMN workspace_id TEXT NOT NULL;
DELETE FROM documents WHERE kind = 'note';
CREATE INDEX documents_workspace ON documents(workspace_id);
