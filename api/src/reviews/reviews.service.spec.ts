import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ReviewsService } from "./reviews.service";

function makeService() {
  const prisma = {
    product: { findUnique: jest.fn() },
    productReview: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    orderItem: { findFirst: jest.fn() },
  };

  return {
    service: new ReviewsService(prisma as never),
    prisma,
  };
}

const activeProduct = { id: "prod-1", status: "ACTIVE" };

describe("ReviewsService (CP17 product reviews)", () => {
  describe("attachSummaries", () => {
    it("attaches the rounded average and count to each product", async () => {
      const { service, prisma } = makeService();

      prisma.productReview.groupBy.mockResolvedValue([
        { productId: "p1", _avg: { rating: 4.333333 }, _count: { _all: 3 } },
      ]);

      const result = await service.attachSummaries([{ id: "p1" }, { id: "p2" }]);

      expect(result).toEqual([
        { id: "p1", ratingAverage: 4.3, ratingCount: 3 },
        { id: "p2", ratingAverage: null, ratingCount: 0 },
      ]);
    });

    it("skips the aggregate query for an empty product list", async () => {
      const { service, prisma } = makeService();

      await expect(service.attachSummaries([])).resolves.toEqual([]);

      expect(prisma.productReview.groupBy).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("404s for an unknown product", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.list("nope")).rejects.toThrow(NotFoundException);
    });

    it("returns the summary and reviews with masked buyer names", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.productReview.findMany.mockResolvedValue([
        {
          id: "rev-1",
          rating: 5,
          comment: "Fresh",
          createdAt: new Date("2026-10-26"),
          buyer: { firstName: "BonAgri", lastName: "Buyer" },
        },
      ]);
      prisma.productReview.aggregate.mockResolvedValue({
        _avg: { rating: 4.5 },
        _count: { _all: 7 },
      });

      const result = await service.list("prod-1");

      expect(result.average).toBe(4.5);
      expect(result.count).toBe(7);
      expect(result.items[0]).toEqual({
        id: "rev-1",
        rating: 5,
        comment: "Fresh",
        createdAt: new Date("2026-10-26"),
        buyerName: "BonAgri B.",
      });
    });
  });

  describe("mine", () => {
    it("allows a review only after delivery and before one exists", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct);

      prisma.productReview.findUnique.mockResolvedValue(null);
      prisma.orderItem.findFirst.mockResolvedValue({ id: "item-1" });
      await expect(service.mine("buyer-1", "prod-1")).resolves.toEqual({
        canReview: true,
        review: null,
      });

      // Delivered but already reviewed → no second chance.
      prisma.productReview.findUnique.mockResolvedValue({ id: "rev-1" });
      await expect(service.mine("buyer-1", "prod-1")).resolves.toMatchObject({
        canReview: false,
      });

      // Not delivered yet → nothing to rate.
      prisma.productReview.findUnique.mockResolvedValue(null);
      prisma.orderItem.findFirst.mockResolvedValue(null);
      await expect(service.mine("buyer-1", "prod-1")).resolves.toMatchObject({
        canReview: false,
      });
    });

    it("scopes the eligibility lookup to this buyer's DELIVERED orders", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.productReview.findUnique.mockResolvedValue(null);
      prisma.orderItem.findFirst.mockResolvedValue(null);

      await service.mine("buyer-1", "prod-1");

      expect(prisma.orderItem.findFirst).toHaveBeenCalledWith({
        where: {
          productId: "prod-1",
          order: { userId: "buyer-1", status: "DELIVERED" },
        },
        select: { id: true },
      });
    });
  });

  describe("create", () => {
    it("404s when the product is unknown or delisted", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(null);
      await expect(
        service.create("buyer-1", "nope", { rating: 5 }),
      ).rejects.toThrow(NotFoundException);

      prisma.product.findUnique.mockResolvedValue({
        id: "prod-1",
        status: "INACTIVE",
      });
      await expect(
        service.create("buyer-1", "prod-1", { rating: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("403s buyers without a delivered order for this product", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.orderItem.findFirst.mockResolvedValue(null);

      await expect(
        service.create("buyer-1", "prod-1", { rating: 5 }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.productReview.create).not.toHaveBeenCalled();
    });

    it("409s a duplicate review from the same buyer", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.orderItem.findFirst.mockResolvedValue({ id: "item-1" });
      prisma.productReview.findUnique.mockResolvedValue({ id: "rev-1" });

      await expect(
        service.create("buyer-1", "prod-1", { rating: 4 }),
      ).rejects.toThrow(ConflictException);
    });

    it("creates the review with a trimmed comment (empty → null)", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.orderItem.findFirst.mockResolvedValue({ id: "item-1" });
      prisma.productReview.findUnique.mockResolvedValue(null);
      prisma.productReview.create.mockResolvedValue({ id: "rev-new" });

      await expect(
        service.create("buyer-1", "prod-1", {
          rating: 4,
          comment: "  Solid produce  ",
        }),
      ).resolves.toEqual({ id: "rev-new" });

      expect(prisma.productReview.create).toHaveBeenCalledWith({
        data: {
          productId: "prod-1",
          buyerId: "buyer-1",
          rating: 4,
          comment: "Solid produce",
        },
      });

      await service.create("buyer-1", "prod-1", { rating: 3, comment: "   " });

      expect(prisma.productReview.create).toHaveBeenLastCalledWith({
        data: {
          productId: "prod-1",
          buyerId: "buyer-1",
          rating: 3,
          comment: null,
        },
      });
    });
  });
});
