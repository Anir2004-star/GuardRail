CREATE TYPE "DeviceType" AS ENUM ('Laptop', 'Smartphone', 'Tablet');
CREATE TABLE "devices" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "type" "DeviceType" NOT NULL,
  "brand" VARCHAR(80),
  "model" VARCHAR(80),
  "os" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "devices_user_id_request_id_key" ON "devices"("user_id", "request_id");
CREATE INDEX "devices_user_id_created_at_id_idx" ON "devices"("user_id", "created_at", "id");
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
