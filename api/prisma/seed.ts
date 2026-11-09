
import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { assertSeedTargetAllowed } from "./local-database";

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

// Refuse a non-local database unless the caller names it explicitly.
assertSeedTargetAllowed(
  connectionString,
  process.env.SEED_ALLOW_REMOTE === "true",
);

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
    {
      name: "Agricultural Tools & Equipment",
      slug: "agricultural-tools",
      description: "Tools, equipment and machinery for agricultural operations.",
    },
    {
      name: "Seeds & Chemicals",
      slug: "seeds-chemicals",
      description: "Seeds, fertilizers and crop-protection chemicals.",
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
      // CP17: the dev supplier mirrors its pre-verified profile badge so the
      // marketplace gates (publish / accept order) pass out of the box.
      businessStatus: "VERIFIED",
      businessVerifiedAt: new Date(),
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
      businessStatus: "VERIFIED",
      businessVerifiedAt: new Date(),
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
      // CP17: dev buyer arrives phone-verified so checkout works without an
      // OTP round-trip; the OTP flow itself is exercised via E2E capture.
      phoneVerifiedAt: new Date(),
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
      phoneVerifiedAt: new Date(),
    },
  });

  // ---------------------------------------------------------------------------
  // Admin account (opt-in via environment; never hard-coded)
  // ---------------------------------------------------------------------------

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        passwordHash: adminPasswordHash,
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      create: {
        email: adminEmail,
        passwordHash: adminPasswordHash,
        firstName: "BonAgri",
        lastName: "Admin",
        phone: null,
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    console.log(`Admin account ready: ${adminEmail}`);
  } else {
    console.log(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set - skipping admin account.",
    );
  }

  // ---------------------------------------------------------------------------
  // Development buyer delivery address
  // ---------------------------------------------------------------------------

  await prisma.address.upsert({
    where: {
      // Must satisfy class-validator's @IsUUID() (valid v4 version/variant digits).
      id: "11111111-1111-4111-8111-111111111111",
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
      id: "11111111-1111-4111-8111-111111111111",
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
  // Development agro-dealer account (CP4)
  // ---------------------------------------------------------------------------

  const dealerUser = await prisma.user.upsert({
    where: { email: "dealer@bonagri.co.za" },
    update: {
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Equipment",
      phone: "+27000000003",
      role: "AGRO_DEALER",
      status: "ACTIVE",
      // Seeded accounts are pre-verified so they can sign in immediately.
      emailVerifiedAt: new Date(),
      // CP17: dev dealer mirrors its profile badge so publish/accept gates
      // pass out of the box.
      businessStatus: "VERIFIED",
      businessVerifiedAt: new Date(),
    },
    create: {
      email: "dealer@bonagri.co.za",
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Equipment",
      phone: "+27000000003",
      role: "AGRO_DEALER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      businessStatus: "VERIFIED",
      businessVerifiedAt: new Date(),
    },
  });

  const dealer = await prisma.supplierProfile.upsert({
    where: { userId: dealerUser.id },
    update: {
      businessName: "Limpopo Agro Equipment",
      description: "Farm tools, fencing and equipment for Limpopo operations.",
      phone: "+27000000003",
      email: "dealer@bonagri.co.za",
      city: "Polokwane",
      province: "Limpopo",
      verified: true,
    },
    create: {
      userId: dealerUser.id,
      businessName: "Limpopo Agro Equipment",
      description: "Farm tools, fencing and equipment for Limpopo operations.",
      phone: "+27000000003",
      email: "dealer@bonagri.co.za",
      city: "Polokwane",
      province: "Limpopo",
      verified: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Development transporter account (CP14) — the delivery board test account
  // ---------------------------------------------------------------------------

  const transporterUser = await prisma.user.upsert({
    where: { email: "driver@bonagri.co.za" },
    update: {
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Driver",
      phone: "+27000000004",
      role: "TRANSPORTER",
      status: "ACTIVE",
      // Seeded accounts are pre-verified so they can sign in immediately.
      emailVerifiedAt: new Date(),
    },
    create: {
      email: "driver@bonagri.co.za",
      passwordHash: devPasswordHash,
      firstName: "BonAgri",
      lastName: "Driver",
      phone: "+27000000004",
      role: "TRANSPORTER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.transporterProfile.upsert({
    where: { userId: transporterUser.id },
    update: {
      businessName: "BonAgri Haulage",
      vehicleType: "Bakkie",
      phone: "+27000000004",
      email: "driver@bonagri.co.za",
      city: "Tzaneen",
      province: "Limpopo",
      serviceProvinces: ["Limpopo", "Gauteng"],
      verified: true,
    },
    create: {
      userId: transporterUser.id,
      businessName: "BonAgri Haulage",
      vehicleType: "Bakkie",
      phone: "+27000000004",
      email: "driver@bonagri.co.za",
      city: "Tzaneen",
      province: "Limpopo",
      serviceProvinces: ["Limpopo", "Gauteng"],
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

  const dealerProducts = [
    {
      name: "Electric Fence Energizer 12J",
      slug: "electric-fence-energizer-12j",
      sku: "BON-EFE-012",
      category: "agricultural-tools",
      price: 1250,
      unit: "each",
      quantity: 25,
      description:
        "12 Joule mains/solar electric fence energizer for livestock and crop protection.",
    },
  ];

  for (const product of dealerProducts) {
    const categoryId = categoryMap.get(product.category);

    if (!categoryId) {
      throw new Error(
        `Category "${product.category}" was not found for product "${product.slug}".`,
      );
    }

    const record = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        supplierId: dealer.id,
        categoryId,
        name: product.name,
        sku: product.sku,
        description: product.description,
        price: product.price,
        unit: product.unit,
        status: "ACTIVE",
      },
      create: {
        supplierId: dealer.id,
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
        lowStockLevel: 5,
      },
      create: {
        productId: record.id,
        quantity: product.quantity,
        lowStockLevel: 5,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // CP17: demo product reviews (development display data)
  // ---------------------------------------------------------------------------
  // The seed creates no orders, so demo reviews are inserted directly here;
  // the API still enforces delivered-order eligibility on every real write.
  // The dev buyer is deliberately NOT given seed reviews so the write-review
  // flow stays testable with buyer@bonagri.co.za.
  const reviewers = [
    { email: "reviewer1@bonagri.co.za", firstName: "Thato", lastName: "Mokoena" },
    { email: "reviewer2@bonagri.co.za", firstName: "Naledi", lastName: "Dlamini" },
    { email: "reviewer3@bonagri.co.za", firstName: "Sipho", lastName: "Nkosi" },
  ];

  const reviewerIds: string[] = [];

  for (const reviewer of reviewers) {
    const record = await prisma.user.upsert({
      where: { email: reviewer.email },
      update: {
        firstName: reviewer.firstName,
        lastName: reviewer.lastName,
        role: "BUYER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      create: {
        email: reviewer.email,
        passwordHash: devPasswordHash,
        firstName: reviewer.firstName,
        lastName: reviewer.lastName,
        phone: null,
        role: "BUYER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    reviewerIds.push(record.id);
  }

  const demoReviews = [
    {
      slug: "fresh-tomatoes",
      reviewer: 0,
      rating: 5,
      comment: "Arrived fresh and neatly packed — will order again.",
    },
    {
      slug: "fresh-tomatoes",
      reviewer: 1,
      rating: 4,
      comment: "Good quality for the price, delivery was on time.",
    },
    {
      slug: "fresh-tomatoes",
      reviewer: 2,
      rating: 4,
      comment: "Portion size matched the listing exactly.",
    },
    {
      slug: "fresh-bananas",
      reviewer: 1,
      rating: 5,
      comment: "Ripe and sweet, nothing bruised in the box.",
    },
    {
      slug: "fresh-bananas",
      reviewer: 2,
      rating: 4,
      comment: "Solid bunch, would have liked a slightly bigger size.",
    },
    {
      slug: "green-chilli",
      reviewer: 0,
      rating: 5,
      comment: "Very fresh and properly hot — exactly what I wanted.",
    },
    {
      slug: "green-chilli",
      reviewer: 1,
      rating: 3,
      comment: "Fine quality, but the delivery arrived a day late.",
    },
    {
      slug: "fresh-okra",
      reviewer: 2,
      rating: 4,
      comment: "Tender pods, no fibrous ones in the batch.",
    },
    {
      slug: "electric-fence-energizer-12j",
      reviewer: 0,
      rating: 5,
      comment: "Installed easily and holds the fence without issues.",
    },
  ];

  const reviewProductIds = new Map(
    (
      await prisma.product.findMany({
        where: { slug: { in: [...new Set(demoReviews.map((r) => r.slug))] } },
        select: { id: true, slug: true },
      })
    ).map((product) => [product.slug, product.id] as const),
  );

  for (const review of demoReviews) {
    const productId = reviewProductIds.get(review.slug);
    const buyerId = reviewerIds[review.reviewer];

    if (!productId || !buyerId) {
      throw new Error(
        `Cannot seed demo review: missing product "${review.slug}" or reviewer ${review.reviewer}.`,
      );
    }

    await prisma.productReview.upsert({
      where: { productId_buyerId: { productId, buyerId } },
      update: { rating: review.rating, comment: review.comment },
      create: {
        productId,
        buyerId,
        rating: review.rating,
        comment: review.comment,
      },
    });
  }

  console.log(
    `Demo product reviews ready: ${demoReviews.length} reviews from ${reviewers.length} dev buyers.`,
  );

  console.log(
    "BonAgri development seed completed: categories, accounts, supplier/dealer profiles, products and inventory.",
  );
  console.log(
    "Categories now include Agricultural Tools & Equipment and Seeds & Chemicals.",
  );
  console.log(
    "Agro dealer: dealer@bonagri.co.za (AGRO_DEALER, Limpopo Agro Equipment).",
  );
  console.log(
    "Transporter: driver@bonagri.co.za (verified board account, Limpopo + Gauteng).",
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
