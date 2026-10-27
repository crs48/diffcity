-- Preserve existing preferences while introducing a default display language.
UPDATE documents
SET value = json_set(value, '$.locale', 'en')
WHERE kind = 'settings' AND key = 'main' AND json_extract(value, '$.locale') IS NULL;
