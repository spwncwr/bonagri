import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
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
      update: category,
      create: category,
    });

    categoryMap.set(record.slug, record.id);
  }

  const supplierUser = await prisma.user.upsert({
    where: { email: "dev@bonagri.co.za" },
    update: {
      firstName: "BonAgri",
      lastName: "Farm",
      phone: "+27000000000",
      role: "SUPPLIER",
      status: "ACTIVE",
    },
    create: {
      email: "dev@bonagri.co.za",
      passwordHash: "development-only",
      firstName: "BonAgri",
      lastName: "Farm",
      phone: "+27000000000",
      role: "SUPPLIER",
      status: "ACTIVE",
    },
  });

  const buyerUser = await prisma.user.upsert({
    where: { email: "buyer@bonagri.co.za" },
    update: {
      firstName: "BonAgri",
      lastName: "Buyer",
      phone: "+27000000001",
      role: "BUYER",
      status: "ACTIVE",
    },
    create: {
      email: "buyer@bonagri.co.za",
      passwordHash: "development-only",
      firstName: "BonAgri",
      lastName: "Buyer",
      phone: "+27000000001",
      role: "BUYER",
      status: "ACTIVE",
    },
  });

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
      throw new Error(`Category not found: ${product.category}`);
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

  console.log("BonAgri development seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
