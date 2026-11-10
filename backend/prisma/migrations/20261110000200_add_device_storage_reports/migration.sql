-- Only the latest bounded capacity snapshot is kept. Existing registrations survive.
CREATE TABLE "device_storage_reports" (
  "device_id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "collected_at" TIMESTAMPTZ(3) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "volumes" JSONB NOT NULL,
  CONSTRAINT "device_storage_reports_pkey" PRIMARY KEY ("device_id"),
  CONSTRAINT "device_storage_reports_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "device_storage_reports_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "device_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "device_storage_reports_credential_id_idx" ON "device_storage_reports"("credential_id");
