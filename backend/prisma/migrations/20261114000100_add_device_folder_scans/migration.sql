CREATE TABLE "device_folder_scans" (
  "device_id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "scan_id" UUID NOT NULL,
  "finished_at" TIMESTAMPTZ(3) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "report" JSONB NOT NULL,
  CONSTRAINT "device_folder_scans_pkey" PRIMARY KEY ("device_id"),
  CONSTRAINT "device_folder_scans_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "device_folder_scans_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "device_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "device_folder_scans_credential_id_idx" ON "device_folder_scans"("credential_id");
