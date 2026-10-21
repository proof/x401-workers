CREATE TABLE x401_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX x401_nonces_expires_at ON x401_nonces (expires_at);
