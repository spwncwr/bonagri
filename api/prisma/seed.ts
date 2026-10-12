
import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// -----------------------------------------------------------------------------
// Development-only seed configuration
// -----------------------------------------------------------------------------

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not configured. Set it in the development environment.",
  );
}

// Require an explicit opt-in before modifying any database.
if (process.env.SEED_DEVELOPMENT_DATA !== "true") {
  throw new Error(
    "Development seed blocked. Verify DATABASE_URL points to the development " +
      "database, then set SEED_DEVELOPMENT_DATA=true to proceed.",
  );
}

// Never run this development seed in a production runtime.
if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed is disabled in production.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  // Development credentials only. Rerunning this seed resets these two
  // development accounts to this password.
  const devPasswordHash = await bcrypt.hash("bonagri2024dev", 12);

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  const categories = [
    {
      name: "Fresh Produce",
      slug: "fresh-produce",
      description: "Fresh agricultural produce from regional suppliers.",
    },
    {
      name: "Fruits",
      slug: "fruits",
      description: "Fresh fruit from agricultural producers.",
    },
    {
      name: "Vegetables",
      slug: "vegetables",
      description: "Fresh vegetables available by quantity and location.",
    },
    {
      name: "Chilli & Sauces",
      slug: "chilli-sauces",
      description: "Fresh and processed chilli products and sauces.",
    },
    {
      name: "Processed Foods",
      slug: "processed-foods",
      description: "Value-added agricultural and food products.",
    },
    {
      name: "Farm Inputs",
      slug: "farm-inputs",
      description: "Agricultural inputs, supplies and production equipment.",
    },
  ];

  const categoryMap = new Map<string, string>();

  for (const category of categories) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
      },
      create: category,
    });

    categoryMap.set(record.slug, record.id);
  }

  // ---------------------------------------------------------------------------
  // Development supplier account
  // ---------------------------------------------------------------------------

  const supplierUser = await prisma.user.upsert({
    where: { email: "dev@bonagri.co.za" },
    update: {
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Farm",
      phone: "+27000000000",
      role: "SUPPLIER",
      status: "ACTIVE",
      // Seeded accounts are pre-verified so they can sign in immediately.
      emailVerifiedAt: new Date(),
    },
    create: {
      email: "dev@bonagri.co.za",
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Farm",
      phone: "+27000000000",
      role: "SUPPLIER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  // ---------------------------------------------------------------------------
  // Development buyer account
  // ---------------------------------------------------------------------------

  const buyerUser = await prisma.user.upsert({
    where: { email: "buyer@bonagri.co.za" },
    update: {
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Buyer",
      phone: "+27000000001",
      role: "BUYER",
      status: "ACTIVE",
      // Seeded accounts are pre-verified so they can sign in immediately.
      emailVerifiedAt: new Date(),
    },
    create: {
      email: "buyer@bonagri.co.za",
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Buyer",
      phone: "+27000000001",
      role: "BUYER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  // ---------------------------------------------------------------------------
  // Development buyer delivery address
  // ---------------------------------------------------------------------------

  await prisma.address.upsert({
    where: {
      id: "00000000-0000-0000-0000-000000000001",
    },
    update: {
      label: "Development Delivery Address",
      recipientName: "BonAgri Buyer",
      phone: "+27000000001",
      addressLine1: "Development Address",
      city: "Tzaneen",
      province: "Limpopo",
      postalCode: "0850",
      country: "South Africa",
      isDefault: true,
    },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      userId: buyerUser.id,
      label: "Development Delivery Address",
      recipientName: "BonAgri Buyer",
      phone: "+27000000001",
      addressLine1: "Development Address",
      city: "Tzaneen",
      province: "Limpopo",
      postalCode: "0850",
      country: "South Africa",
      isDefault: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Supplier profile
  // ---------------------------------------------------------------------------

  const supplier = await prisma.supplierProfile.upsert({
    where: { userId: supplierUser.id },
    update: {
      businessName: "BonAgri Farm",
      description: "Development supplier for the BonAgri marketplace pilot.",
      phone: "+27000000000",
      email: "dev@bonagri.co.za",
      city: "Tzaneen",
      province: "Limpopo",
      verified: true,
    },
    create: {
      userId: supplierUser.id,
      businessName: "BonAgri Farm",
      description: "Development supplier for the BonAgri marketplace pilot.",
      phone: "+27000000000",
      email: "dev@bonagri.co.za",
      city: "Tzaneen",
      province: "Limpopo",
      verified: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Development products and inventory
  // ---------------------------------------------------------------------------

  const products = [
    {
      name: "Fresh Tomatoes",
      slug: "fresh-tomatoes",
      sku: "BON-TOM-001",
      category: "fresh-produce",
      price: 18,
      unit: "kg",
      quantity: 2500,
      description: "Fresh tomatoes available from Tzaneen, Limpopo.",
    },
    {
      name: "Fresh Bananas",
      slug: "fresh-bananas",
      sku: "BON-BAN-001",
      category: "fruits",
      price: 25,
      unit: "kg",
      quantity: 800,
      description: "Fresh bananas supplied from Mopani, Limpopo.",
    },
    {
      name: "Green Chilli",
      slug: "green-chilli",
      sku: "BON-CHI-001",
      category: "chilli-sauces",
      price: 32,
      unit: "kg",
      quantity: 400,
      description: "Fresh green chilli from Giyani, Limpopo.",
    },
    {
      name: "Fresh Okra",
      slug: "fresh-okra",
      sku: "BON-OKR-001",
      category: "vegetables",
      price: 28,
      unit: "kg",
      quantity: 250,
      description: "Fresh okra supplied from Polokwane, Limpopo.",
    },
  ];

  for (const product of products) {
    const categoryId = categoryMap.get(product.category);

    if (!categoryId) {
      throw new Error(
        `Category "${product.category}" was not found for product "${product.slug}".`,
      );
    }

    const record = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        supplierId: supplier.id,
        categoryId,
        name: product.name,
        sku: product.sku,
        description: product.description,
        price: product.price,
        unit: product.unit,
        status: "ACTIVE",
      },
      create: {
        supplierId: supplier.id,
        categoryId,
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        description: product.description,
        price: product.price,
        unit: product.unit,
        status: "ACTIVE",
      },
    });

    await prisma.inventory.upsert({
      where: { productId: record.id },
      update: {
        quantity: product.quantity,
        lowStockLevel: 10,
      },
      create: {
        productId: record.id,
        quantity: product.quantity,
        lowStockLevel: 10,
      },
    });
  }

  console.log(
    "BonAgri development seed completed: categories, accounts, supplier profile, products and inventory.",
  );
}

main()
  .catch((error: unknown) => {
    console.error("BonAgri development seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
