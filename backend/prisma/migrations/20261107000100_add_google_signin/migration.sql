ALTER TABLE "users" ADD COLUMN "google_subject" VARCHAR(255);
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");
CREATE TABLE "google_challenges" (
  "id" UUID NOT NULL,
  "secret_hash" CHAR(64) NOT NULL,
  "nonce_hash" CHAR(64) NOT NULL,
  "intent" VARCHAR(10) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  CONSTRAINT "google_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "google_challenges_secret_hash_key" ON "google_challenges"("secret_hash");
CREATE INDEX "google_challenges_expires_at_idx" ON "google_challenges"("expires_at");
