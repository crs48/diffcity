CREATE TABLE IF NOT EXISTS documents (
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated TEXT NOT NULL,
    PRIMARY KEY (kind, key)
);
