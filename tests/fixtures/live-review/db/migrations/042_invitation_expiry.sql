-- Synthetic revision update: verify that changed code needs a new review.
ALTER TABLE invitations ADD COLUMN expires_at TIMESTAMPTZ NOT NULL;
CREATE INDEX invitation_expiry ON invitations (expires_at);
