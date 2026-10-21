-- Notes are scoped to immutable snapshots; keep these lookups indexed.
CREATE INDEX documents_snapshot ON documents(kind, json_extract(value, '$.snapshotId'));
CREATE INDEX documents_updated ON documents(kind, updated);
