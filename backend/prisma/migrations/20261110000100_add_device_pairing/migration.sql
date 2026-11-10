-- Additive: existing users and device registrations are preserved.
CREATE TYPE "PairingState" AS ENUM ('Waiting', 'Claimed', 'Approved', 'Completed', 'Cancelled', 'Rejected');
CREATE TABLE "device_pairing_sessions" (
  "id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "state" "PairingState" NOT NULL DEFAULT 'Waiting',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "claim_id" UUID,
  "claim_token_hash" CHAR(64),
  "comparison_code" VARCHAR(6),
  "app_name" VARCHAR(80),
  "platform" VARCHAR(80),
  "app_version" VARCHAR(40),
  CONSTRAINT "device_pairing_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_pairing_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "device_pairing_sessions_code_hash_key" ON "device_pairing_sessions"("code_hash");
CREATE UNIQUE INDEX "device_pairing_sessions_claim_id_key" ON "device_pairing_sessions"("claim_id");
CREATE UNIQUE INDEX "device_pairing_sessions_claim_token_hash_key" ON "device_pairing_sessions"("claim_token_hash");
CREATE INDEX "device_pairing_sessions_device_id_created_at_idx" ON "device_pairing_sessions"("device_id", "created_at");
CREATE INDEX "device_pairing_sessions_expires_at_idx" ON "device_pairing_sessions"("expires_at");
CREATE TABLE "device_credentials" (
  "id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "pairing_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_credentials_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "device_credentials_pairing_id_fkey" FOREIGN KEY ("pairing_id") REFERENCES "device_pairing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "device_credentials_pairing_id_key" ON "device_credentials"("pairing_id");
CREATE UNIQUE INDEX "device_credentials_token_hash_key" ON "device_credentials"("token_hash");
CREATE INDEX "device_credentials_device_id_idx" ON "device_credentials"("device_id");
CREATE INDEX "device_credentials_expires_at_idx" ON "device_credentials"("expires_at");
