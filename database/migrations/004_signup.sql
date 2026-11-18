-- Self-registration: a request made from the sign-in page waits here (disabled and pending) until an admin approves it.
ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
