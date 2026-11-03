// Public catalog payload shape returned by GET /api/products.
export type ApiProduct = {
  id: string;
  slug: string;
  name: string;
  sku?: string;
  description: string | null;
  price: string;
  unit: string;
  status: string;
  imageUrl: string | null;
  ratingAverage?: number | null;
  ratingCount?: number;
  category: {
    name: string;
    slug: string;
  };
  supplier: {
    businessName: string;
    city: string | null;
    province: string | null;
    verified: boolean;
  };
  inventory: {
    quantity: number;
    reservedQuantity: number;
  } | null;
};

// Marketplace card shape shared by the product grid and the scroll rails.
export type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string | null;
  quantity: string;
  availableQuantity: number;
  location: string;
  price: string;
  unit: string;
  supplier: string;
  verified: boolean;
  imageUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  tone: string;
  visual: string;
};

const productVisuals: Record<string, { tone: string; visual: string }> = {
  "fresh-tomatoes": { tone: "bg-[#dfe9d8]", visual: "TOMATO" },
  "fresh-bananas": { tone: "bg-[#eee8c9]", visual: "BANANA" },
  "green-chilli": { tone: "bg-[#dce9d7]", visual: "CHILLI" },
  "fresh-okra": { tone: "bg-[#e5ead8]", visual: "OKRA" },
};

function formatQuantity(quantity: number, unit: string) {
  return `${quantity.toLocaleString()} ${unit} available`;
}

export function mapApiProduct(product: ApiProduct): Product {
  const visual = productVisuals[product.slug] ?? {
    tone: "bg-[#e5ead8]",
    visual: "PRODUCT",
  };

  const location = [product.supplier.city, product.supplier.province]
    .filter(Boolean)
    .join(", ");

  const availableQuantity = Math.max(
    0,
    (product.inventory?.quantity ?? 0) -
      (product.inventory?.reservedQuantity ?? 0),
  );

  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? "",
    category: product.category.name,
    description: product.description ?? null,
    quantity: formatQuantity(availableQuantity, product.unit),
    availableQuantity,
    location,
    price: `R${product.price}`,
    unit: `/ ${product.unit}`,
    supplier: product.supplier.businessName,
    verified: product.supplier.verified,
    imageUrl: product.imageUrl ?? null,
    ratingAverage: product.ratingAverage ?? null,
    ratingCount: product.ratingCount ?? 0,
    tone: visual.tone,
    visual: visual.visual,
  };
}
