import { PrismaClient } from "@prisma/client";

/**
 * Aura's 2025 printed catalogue, as data.
 *
 * Run once to put the categories and models into a live install:
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env.prod \
 *     exec api npx tsx prisma/load-catalogue.ts
 *
 * Safe to run twice: a model already present by SKU is left exactly as it is,
 * so re-running never overwrites a price someone has since typed in.
 *
 * Every model arrives switched OFF and priced at zero, because the catalogue
 * carries no prices. The owner sets each price in Setup → Products and turns it
 * on; until then it cannot reach an order.
 */
const db = new PrismaClient();

type Model = [sku: string, name: string, description: string];

const CATALOGUE: { nameAr: string; nameEn: string; models: Model[] }[] = [
  {
    nameAr: "غرف السفرة",
    nameEn: "Dining rooms",
    models: [
      ["DIN-LAVENDER", "LAVENDER",
        "A refined dining experience that blends warm elegance with modern comfort, creating the perfect setting for timeless moments."],
      ["DIN-LORA", "LORA",
        "A modern harmony of warmth and sophistication, crafted to elevate every dining moment."],
      ["DIN-GALAXY", "GALAXY",
        "Contemporary elegance shaped with bold lines and a sleek, refined presence."],
    ],
  },
  {
    nameAr: "غرف النوم",
    nameEn: "Bedrooms",
    models: [
      ["BED-CHICAGO-MASTER", "CHICAGO MASTER", "Refined comfort for a truly restful escape."],
      ["BED-CELINE", "CELINE",
        "A soft, modern sanctuary designed for pure comfort and effortless elegance."],
      ["BED-LAMAR", "LAMAR",
        "Contemporary serenity crafted with soft tones and refined details for a truly calming retreat."],
      ["BED-GUSSI", "GUSSI", "Refined comfort for a truly restful escape."],
      ["BED-ROTANA", "ROTANA",
        "A soft, modern sanctuary designed for pure comfort and effortless elegance."],
      ["BED-SBM1", "SBM1",
        "Contemporary serenity crafted with soft tones and refined details for a truly calming retreat."],
      ["BED-SKM1", "SKM1", "Refined comfort for a truly restful escape."],
    ],
  },
  {
    nameAr: "غرف الأطفال",
    nameEn: "Kids bedrooms",
    models: [
      ["KID-AMERICANA", "AMERICANA",
        "A cozy, timeless room crafted for comfort, creativity, and everyday joy."],
      ["KID-CHICAGO", "CHICAGO",
        "A warm, modern space designed to bring comfort, calm, and everyday inspiration."],
    ],
  },
];

async function main() {
  let addedCategories = 0, addedModels = 0, kept = 0;

  for (const group of CATALOGUE) {
    let category = await db.productCategory.findFirst({ where: { nameAr: group.nameAr } });
    if (!category) {
      category = await db.productCategory.create({
        data: { nameAr: group.nameAr, nameEn: group.nameEn },
      });
      addedCategories++;
    }

    for (const [sku, name, description] of group.models) {
      if (await db.product.findUnique({ where: { sku } })) { kept++; continue; }
      await db.product.create({
        data: {
          sku,
          // A model name is a brand, not a word to translate: LAVENDER is
          // LAVENDER on both sides of the language switch.
          nameAr: name,
          nameEn: name,
          description,
          categoryId: category.id,
          // Every page of the catalogue says the same thing: fabric, colour,
          // dimensions, design and specification are the customer's to choose.
          kind: "CUSTOMIZABLE",
          basePrice: "0",
          isActive: false,
        },
      });
      addedModels++;
    }
  }

  console.log(`\n  categories added: ${addedCategories}`);
  console.log(`  models added:     ${addedModels}`);
  if (kept) console.log(`  already present:  ${kept} (left untouched)`);
  console.log("\n  Every model is switched off with no price.");
  console.log("  Setup → Products → Edit: set the price, then Activate.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
