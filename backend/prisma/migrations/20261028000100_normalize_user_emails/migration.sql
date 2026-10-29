BEGIN;

-- Prevent writes while checking and normalizing existing emails.
LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;

-- Stop safely if normalization would merge two existing accounts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    GROUP BY lower(btrim("email"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Email normalization conflicts exist. Resolve them before retrying.';
  END IF;
END
$$;

-- Preserve accounts while normalizing their email addresses.
UPDATE "users"
SET "email" = lower(btrim("email"))
WHERE "email" IS DISTINCT FROM lower(btrim("email"));

-- Require stored emails to remain lowercase without surrounding spaces.
ALTER TABLE "users"
ADD CONSTRAINT "users_email_normalized_check"
CHECK ("email" = lower(btrim("email")));

COMMIT;