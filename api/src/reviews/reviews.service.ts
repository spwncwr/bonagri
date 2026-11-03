import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReviewDto } from "./dto/create-review.dto";

type ReviewWithBuyer = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  buyer: { firstName: string; lastName: string };
};

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // CP17: rating summary attached to the public product payloads so cards can
  // show an average without a second request.
  async attachSummaries<T extends { id: string }>(products: T[]) {
    if (products.length === 0) {
      return products.map((product) => this.withSummary(product, null, 0));
    }

    const grouped = await this.prisma.productReview.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((product) => product.id) } },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const byProductId = new Map(
      grouped.map((entry) => [entry.productId, entry] as const),
    );

    return products.map((product) => {
      const entry = byProductId.get(product.id);
      return this.withSummary(
        product,
        entry?._avg.rating ?? null,
        entry?._count._all ?? 0,
      );
    });
  }

  async list(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const [items, aggregate] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { buyer: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.productReview.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    return {
      productId,
      average: this.round(aggregate._avg.rating),
      count: aggregate._count._all,
      items: items.map((item) => this.present(item)),
    };
  }

  // The product screen asks this (as the signed-in buyer) to decide whether to
  // show the write-review form.
  async mine(userId: string, productId: string) {
    await this.requireProduct(productId);

    const review = await this.prisma.productReview.findUnique({
      where: { productId_buyerId: { productId, buyerId: userId } },
    });

    const delivered = await this.hasDeliveredOrder(userId, productId);

    return {
      canReview: delivered && !review,
      review,
    };
  }

  async create(userId: string, productId: string, dto: CreateReviewDto) {
    await this.requireProduct(productId);

    if (!(await this.hasDeliveredOrder(userId, productId))) {
      throw new ForbiddenException(
        "You can only review products after your order has been delivered",
      );
    }

    const existing = await this.prisma.productReview.findUnique({
      where: { productId_buyerId: { productId, buyerId: userId } },
    });

    if (existing) {
      throw new ConflictException(
        "You have already reviewed this product",
      );
    }

    const comment = dto.comment?.trim();

    return this.prisma.productReview.create({
      data: {
        productId,
        buyerId: userId,
        rating: dto.rating,
        comment: comment ? comment : null,
      },
    });
  }

  private async requireProduct(productId: string) {
    // Delisted/draft products keep their reviews but stop accepting new ones.
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    });

    if (!product || product.status !== "ACTIVE") {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  // Eligibility = at least one order line for this product whose order reached
  // DELIVERED for this buyer.
  private async hasDeliveredOrder(userId: string, productId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: { userId, status: "DELIVERED" },
      },
      select: { id: true },
    });

    return Boolean(item);
  }

  private withSummary<T extends { id: string }>(
    product: T,
    average: number | null,
    count: number,
  ) {
    return {
      ...product,
      ratingAverage: this.round(average),
      ratingCount: count,
    };
  }

  private round(value: number | null) {
    return value === null ? null : Math.round(value * 10) / 10;
  }

  private present(review: ReviewWithBuyer) {
    const { firstName, lastName } = review.buyer;

    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      // Buyers are private parties — show a name, not an account identity.
      buyerName: `${firstName} ${lastName.charAt(0)}.`,
    };
  }
}
