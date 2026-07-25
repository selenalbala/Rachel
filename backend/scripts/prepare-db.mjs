import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Preparando la base de datos antes de actualizar el esquema…");

  // Convierte la unidad antigua CAJA a UNIDAD antes de eliminarla del enum.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'unit'
      ) THEN
        UPDATE "Product"
        SET "unit" = 'UNIDAD'::"ProductUnit"
        WHERE "unit"::text = 'CAJA';
      END IF;
    END $$;
  `);

  // Conserva las categorías antiguas de los servicios migrándolas al nuevo modelo Category.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Service' AND column_name = 'category'
      ) THEN
        CREATE TABLE IF NOT EXISTS "Category" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "color" TEXT NOT NULL DEFAULT '#B8A48A',
          "active" BOOLEAN NOT NULL DEFAULT TRUE,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");

        ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

        INSERT INTO "Category" ("id", "name", "color", "active", "createdAt", "updatedAt")
        SELECT
          md5(random()::text || clock_timestamp()::text || s."category"),
          s."category",
          COALESCE(NULLIF(MAX(s."color"), ''), '#B8A48A'),
          TRUE,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "Service" s
        WHERE s."category" IS NOT NULL AND btrim(s."category") <> ''
        GROUP BY s."category"
        ON CONFLICT ("name") DO UPDATE
          SET "color" = EXCLUDED."color", "updatedAt" = CURRENT_TIMESTAMP;

        UPDATE "Service" s
        SET "categoryId" = c."id"
        FROM "Category" c
        WHERE s."category" = c."name" AND s."categoryId" IS NULL;
      END IF;
    END $$;
  `);

  // Evita que los nuevos índices únicos fallen: conserva un email/googleSub y limpia duplicados.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Client' AND column_name = 'email'
      ) THEN
        WITH duplicated AS (
          SELECT "id", ROW_NUMBER() OVER (
            PARTITION BY lower("email") ORDER BY "createdAt", "id"
          ) AS position
          FROM "Client"
          WHERE "email" IS NOT NULL AND btrim("email") <> ''
        )
        UPDATE "Client" c
        SET "email" = NULL
        FROM duplicated d
        WHERE c."id" = d."id" AND d.position > 1;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Client' AND column_name = 'googleSub'
      ) THEN
        WITH duplicated AS (
          SELECT "id", ROW_NUMBER() OVER (
            PARTITION BY "googleSub" ORDER BY "createdAt", "id"
          ) AS position
          FROM "Client"
          WHERE "googleSub" IS NOT NULL AND btrim("googleSub") <> ''
        )
        UPDATE "Client" c
        SET "googleSub" = NULL
        FROM duplicated d
        WHERE c."id" = d."id" AND d.position > 1;
      END IF;
    END $$;
  `);

  console.log("Preparación completada: categorías conservadas y datos obsoletos listos para eliminar.");
}

main()
  .catch((error) => {
    console.error("No se pudo preparar la base de datos:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
