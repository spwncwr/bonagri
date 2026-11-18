import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { RequestsService } from "./requests.service";

function makeService() {
  const prisma = {
    category: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    address: { findFirst: jest.fn() },
    product: { findFirst: jest.fn(), findUnique: jest.fn() },
    inventory: { update: jest.fn() },
    order: { create: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    productRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    supplierProfile: { findUnique: jest.fn() },
    requestResponse: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    // Both Prisma flavours used in the codebase: array form (parallel
    // promises) and interactive callback form (F1 quote checkout).
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };

  const notifications = {
    onRequestResponseAccepted: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new RequestsService(prisma as never, notifications as never),
    prisma,
    notifications,
  };
}

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

describe("RequestsService (CP7 product requests)", () => {
  describe("create", () => {
    it("creates an OPEN request with trimmed fields", async () => {
      const { service, prisma } = makeService();

      prisma.category.findUnique.mockResolvedValue({ id: "cat-1" });
      prisma.productRequest.create.mockResolvedValue({ id: "req-1" });

      await expect(
        service.create("buyer-1", {
          title: "  Tomatoes  ",
          categoryId: "cat-1",
          quantity: 300,
          unit: " kg ",
          destinationCity: " Polokwane ",
          requiredBy: futureDate,
          notes: " Grade 1 only ",
        }),
      ).resolves.toEqual({ id: "req-1" });

      expect(prisma.productRequest.create).toHaveBeenCalledWith({
        data: {
          buyerId: "buyer-1",
          title: "Tomatoes",
          categoryId: "cat-1",
          quantity: 300,
          unit: "kg",
          destinationCity: "Polokwane",
          requiredBy: new Date(futureDate),
          notes: "Grade 1 only",
        },
        include: {
          category: { select: { name: true, slug: true } },
        },
      });
    });

    it("accepts an optional request without category or date", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.create.mockResolvedValue({ id: "req-2" });

      await service.create("buyer-1", {
        title: "Maize",
        quantity: 10,
        unit: "tons",
      });

      expect(prisma.category.findUnique).not.toHaveBeenCalled();
      expect(prisma.productRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            categoryId: null,
            requiredBy: null,
            destinationCity: null,
            notes: null,
          }),
        }),
      );
    });

    it("rejects an unknown category", async () => {
      const { service, prisma } = makeService();

      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create("buyer-1", {
          title: "Tomatoes",
          categoryId: "ghost",
          quantity: 1,
          unit: "kg",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productRequest.create).not.toHaveBeenCalled();
    });

    it("rejects a requiredBy date in the past", async () => {
      const { service, prisma } = makeService();

      await expect(
        service.create("buyer-1", {
          title: "Tomatoes",
          quantity: 1,
          unit: "kg",
          requiredBy: "2020-01-01",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productRequest.create).not.toHaveBeenCalled();
    });
  });

  describe("listOpen (public demand board)", () => {
    it("returns only OPEN requests, newest first, capped, without buyer identity", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.findMany.mockResolvedValue([]);

      await expect(service.listOpen()).resolves.toEqual([]);

      expect(prisma.productRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "OPEN" },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      );

      // Prisma scalars like buyerId leak unless explicitly excluded.
      const query = prisma.productRequest.findMany.mock.calls[0][0];
      expect(query.select).toBeDefined();
      expect(JSON.stringify(query.select)).not.toContain("buyerId");
      expect(JSON.stringify(query.select)).not.toContain("buyer");
    });
  });

  describe("getMine", () => {
    it("scopes the list to the caller", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.findMany.mockResolvedValue([]);

      await service.getMine("buyer-1");

      expect(prisma.productRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buyerId: "buyer-1" },
        }),
      );
    });
  });

  describe("update", () => {
    const openRequest = { id: "req-1", buyerId: "buyer-1", status: "OPEN" };

    it("withdraws an OPEN request (OPEN -> WITHDRAWN)", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.findUnique.mockResolvedValue(openRequest);
      prisma.productRequest.update.mockResolvedValue({
        ...openRequest,
        status: "WITHDRAWN",
      });

      await expect(
        service.update("req-1", "buyer-1", { status: "WITHDRAWN" }),
      ).resolves.toMatchObject({ status: "WITHDRAWN" });

      expect(prisma.productRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "req-1" },
          data: { status: "WITHDRAWN" },
        }),
      );
    });

    it("marks an OPEN request fulfilled (OPEN -> FULFILLED)", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.findUnique.mockResolvedValue(openRequest);
      prisma.productRequest.update.mockResolvedValue({
        ...openRequest,
        status: "FULFILLED",
      });

      await expect(
        service.update("req-1", "buyer-1", { status: "FULFILLED" }),
      ).resolves.toMatchObject({ status: "FULFILLED" });
    });

    it("404s unknown requests and other buyers' requests alike", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.update("ghost", "buyer-1", { status: "WITHDRAWN" }),
      ).rejects.toThrow(NotFoundException);

      prisma.productRequest.findUnique.mockResolvedValue({
        ...openRequest,
        buyerId: "someone-else",
      });
      await expect(
        service.update("req-1", "buyer-1", { status: "WITHDRAWN" }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.productRequest.update).not.toHaveBeenCalled();
    });

    it("rejects transitions out of terminal states with 409", async () => {
      const { service, prisma } = makeService();

      for (const status of ["WITHDRAWN", "FULFILLED"]) {
        prisma.productRequest.findUnique.mockResolvedValue({
          ...openRequest,
          status,
        });

        await expect(
          service.update("req-1", "buyer-1", { status: "WITHDRAWN" }),
        ).rejects.toThrow(ConflictException);
      }

      expect(prisma.productRequest.update).not.toHaveBeenCalled();
    });
  });

  describe("respond (CP9 + F1 product-backed quotes)", () => {
    const openRequest = { id: "req-1", status: "OPEN" };

    it("creates a response for a supplier with a profile and their product", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.productRequest.findUnique.mockResolvedValue(openRequest);
      prisma.product.findFirst.mockResolvedValue({ id: "prod-1" });
      prisma.requestResponse.findUnique.mockResolvedValue(null);
      prisma.requestResponse.create.mockResolvedValue({ id: "resp-1" });

      await expect(
        service.respond("req-1", "vendor-1", {
          message: "  We can supply this  ",
          productId: "prod-1",
          quotedPrice: 12.5,
          quotedUnit: "per kg",
        }),
      ).resolves.toEqual({ id: "resp-1" });

      // The product must be the caller's OWN active listing — that is what
      // an accepted quote later converts into an order for.
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prod-1", supplierId: "sup-1", status: "ACTIVE" },
        }),
      );
      expect(prisma.requestResponse.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: "req-1",
            supplierId: "sup-1",
            productId: "prod-1",
            message: "We can supply this",
            quotedPrice: 12.5,
            quotedUnit: "per kg",
          }),
        }),
      );
    });

    it("403s a buyer with no supplier profile", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.respond("req-1", "buyer-1", {
          message: "hi",
          productId: "prod-1",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.requestResponse.create).not.toHaveBeenCalled();
    });

    it("400s a quote whose product is not the caller's active listing", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.productRequest.findUnique.mockResolvedValue(openRequest);
      // Wrong supplier, DRAFT, or simply missing — all resolve to null.
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.respond("req-1", "vendor-1", {
          message: "hi",
          productId: "prod-x",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.requestResponse.create).not.toHaveBeenCalled();
    });

    it("409s responses to non-OPEN requests and duplicates", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.productRequest.findUnique.mockResolvedValue({
        id: "req-1",
        status: "WITHDRAWN",
      });
      await expect(
        service.respond("req-1", "vendor-1", {
          message: "hi",
          productId: "prod-1",
        }),
      ).rejects.toThrow(ConflictException);

      prisma.productRequest.findUnique.mockResolvedValue(openRequest);
      prisma.product.findFirst.mockResolvedValue({ id: "prod-1" });
      prisma.requestResponse.findUnique.mockResolvedValue({ id: "resp-x" });
      await expect(
        service.respond("req-1", "vendor-1", {
          message: "hi",
          productId: "prod-1",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("listResponses / listMyResponses", () => {
    it("buyer-owner reads responses; foreign/unknown request 404s", async () => {
      const { service, prisma } = makeService();

      prisma.productRequest.findUnique.mockResolvedValue({
        id: "req-1",
        buyerId: "buyer-1",
      });
      prisma.requestResponse.findMany.mockResolvedValue([]);
      await expect(
        service.listResponses("req-1", "buyer-1"),
      ).resolves.toEqual([]);

      prisma.productRequest.findUnique.mockResolvedValue({
        id: "req-1",
        buyerId: "someone-else",
      });
      await expect(
        service.listResponses("req-1", "buyer-1"),
      ).rejects.toThrow(NotFoundException);

      prisma.productRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.listResponses("ghost", "buyer-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("vendors see only their own responses", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.requestResponse.findMany.mockResolvedValue([]);

      await service.listMyResponses("vendor-1");

      expect(prisma.requestResponse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: "sup-1" } }),
      );
    });
  });

  describe("updateResponse (CP9)", () => {
    const response = {
      id: "resp-1",
      status: "OPEN",
      requestId: "req-1",
      supplier: {
        userId: "vendor-1",
        businessName: "Fresh Farm",
        user: { id: "vendor-1", email: "v@x", firstName: "V" },
      },
      request: { id: "req-1", title: "Tomatoes", buyerId: "buyer-1" },
    };

    it("accept closes competing responses in one transaction and notifies", async () => {
      const { service, prisma, notifications } = makeService();

      prisma.requestResponse.findUnique.mockResolvedValue(response);
      prisma.requestResponse.updateMany.mockResolvedValue({ count: 1 });
      prisma.requestResponse.update.mockResolvedValue({
        id: "resp-1",
        status: "ACCEPTED",
      });

      await expect(
        service.updateResponse("resp-1", "buyer-1", { status: "ACCEPTED" }),
      ).resolves.toMatchObject({ status: "ACCEPTED" });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.requestResponse.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            requestId: "req-1",
            status: "OPEN",
            id: { not: "resp-1" },
          }),
          data: { status: "DECLINED" },
        }),
      );
      expect(notifications.onRequestResponseAccepted).toHaveBeenCalledWith(
        response.supplier.user,
        "Tomatoes",
      );
    });

    it("vendor withdraws own response; buyer cannot withdraw", async () => {
      const { service, prisma } = makeService();

      prisma.requestResponse.findUnique.mockResolvedValue(response);
      prisma.requestResponse.update.mockResolvedValue({
        id: "resp-1",
        status: "WITHDRAWN",
      });

      await expect(
        service.updateResponse("resp-1", "vendor-1", { status: "WITHDRAWN" }),
      ).resolves.toMatchObject({ status: "WITHDRAWN" });

      await expect(
        service.updateResponse("resp-1", "buyer-1", { status: "WITHDRAWN" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("vendor cannot accept/decline; buyer cannot act on foreign responses", async () => {
      const { service, prisma } = makeService();

      prisma.requestResponse.findUnique.mockResolvedValue(response);

      await expect(
        service.updateResponse("resp-1", "vendor-1", { status: "ACCEPTED" }),
      ).rejects.toThrow(NotFoundException);

      prisma.requestResponse.findUnique.mockResolvedValue({
        ...response,
        request: { ...response.request, buyerId: "someone-else" },
      });
      await expect(
        service.updateResponse("resp-1", "buyer-1", { status: "DECLINED" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects acting on non-OPEN responses with 409", async () => {
      const { service, prisma } = makeService();

      prisma.requestResponse.findUnique.mockResolvedValue({
        ...response,
        status: "DECLINED",
      });

      await expect(
        service.updateResponse("resp-1", "buyer-1", { status: "ACCEPTED" }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.requestResponse.update).not.toHaveBeenCalled();
    });
  });

  describe("checkoutResponse (F1 quote → order)", () => {
    const acceptedQuote = {
      id: "resp-1",
      status: "ACCEPTED",
      orderId: null,
      productId: "prod-1",
      quotedPrice: 12.5,
      supplierId: "sup-1",
      request: { buyerId: "buyer-1", quantity: 40, unit: "kg" },
    };

    const buyer = {
      id: "buyer-1",
      role: "BUYER",
      status: "ACTIVE",
      phoneVerifiedAt: new Date("2026-11-01"),
    };

    const address = { id: "addr-1", userId: "buyer-1" };

    const product = {
      id: "prod-1",
      name: "Tomatoes",
      unit: "kg",
      status: "ACTIVE",
      supplierId: "sup-1",
      supplier: { businessName: "Fresh Farm" },
      inventory: { quantity: 500, reservedQuantity: 100 },
    };

    // Wires every model the happy path touches; individual tests override.
    function primeHappyPath(prisma: ReturnType<typeof makeService>["prisma"]) {
      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.address.findFirst.mockResolvedValue(address);
      prisma.requestResponse.findUnique.mockResolvedValue(acceptedQuote);
      prisma.product.findUnique.mockResolvedValue(product);
      prisma.order.create.mockResolvedValue({
        id: "order-1",
        orderNumber: "BON-20261118-123456",
        status: "PENDING",
        subtotal: 500,
        deliveryFee: 0,
        total: 500,
        items: [
          { productId: "prod-1", productName: "Tomatoes", unitPrice: 12.5, quantity: 40, lineTotal: 500 },
        ],
        deliveryAddress: { id: "addr-1" },
      });
      prisma.requestResponse.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventory.update.mockResolvedValue({});
      prisma.orderStatusHistory.create.mockResolvedValue({});
    }

    const dto = { deliveryAddressId: "addr-1", notes: "Gate 4" };

    it("prices the order at the quoted figure, not the catalog price", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      const result = await service.checkoutResponse(
        "resp-1",
        "buyer-1",
        dto,
      );

      // 12.5 quoted × 40 requested = 500 agreed — regardless of what the
      // product row lists.
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotal: 500,
            deliveryFee: 0,
            total: 500,
            notes: "Gate 4",
            items: {
              create: [
                expect.objectContaining({
                  productId: "prod-1",
                  unitPrice: 12.5,
                  quantity: 40,
                  lineTotal: 500,
                }),
              ],
            },
          }),
        }),
      );

      expect(result).toMatchObject({ orderCount: 1 });
      expect(result.orders[0]).toMatchObject({
        orderNumber: "BON-20261118-123456",
        supplierName: "Fresh Farm",
        total: 500,
      });

      // Claim + reserve + history all ran.
      expect(prisma.requestResponse.updateMany).toHaveBeenCalledWith({
        where: { id: "resp-1", orderId: null },
        data: { orderId: "order-1" },
      });
      expect(prisma.inventory.update).toHaveBeenCalledWith({
        where: { productId: "prod-1" },
        data: { reservedQuantity: { increment: 40 } },
      });
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: "order-1",
          toStatus: "PENDING",
          note: "Order placed from accepted quote",
        }),
      });
      // Single order — no group id.
      expect(
        prisma.order.create.mock.calls[0][0].data.orderGroupId,
      ).toBeUndefined();
    });

    it("404s foreign and unknown quotes alike", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      prisma.requestResponse.findUnique.mockResolvedValue(null);
      await expect(
        service.checkoutResponse("ghost", "buyer-1", dto),
      ).rejects.toThrow(NotFoundException);

      prisma.requestResponse.findUnique.mockResolvedValue({
        ...acceptedQuote,
        request: { ...acceptedQuote.request, buyerId: "someone-else" },
      });
      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(NotFoundException);

      // Ownership is decided BEFORE caller preconditions: even an
      // unverified stranger gets the flat 404, never a phone-gate 403
      // that would hint the quote exists.
      prisma.user.findUnique.mockResolvedValue({
        ...buyer,
        phoneVerifiedAt: null,
      });
      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("409s quotes that are not ACCEPTED", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      for (const status of ["OPEN", "DECLINED", "WITHDRAWN"]) {
        prisma.requestResponse.findUnique.mockResolvedValue({
          ...acceptedQuote,
          status,
        });
        await expect(
          service.checkoutResponse("resp-1", "buyer-1", dto),
        ).rejects.toThrow(ConflictException);
      }

      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("409s an already-converted quote (double-submit guard)", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      prisma.requestResponse.findUnique.mockResolvedValue({
        ...acceptedQuote,
        orderId: "order-prev",
      });

      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(ConflictException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("409s when the claim loses the race (count 0 rolls the order back)", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      // Another submit claimed the quote between our read and our write.
      prisma.requestResponse.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(ConflictException);
      expect(prisma.inventory.update).not.toHaveBeenCalled();
    });

    it("409s legacy quotes without a product or agreed price", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      prisma.requestResponse.findUnique.mockResolvedValue({
        ...acceptedQuote,
        productId: null,
      });
      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(ConflictException);

      prisma.requestResponse.findUnique.mockResolvedValue({
        ...acceptedQuote,
        quotedPrice: null,
      });
      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(ConflictException);

      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("409s when the product went inactive or stock is short", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      prisma.product.findUnique.mockResolvedValue({
        ...product,
        status: "DRAFT",
      });
      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(ConflictException);

      // 40 requested vs 400 free (500 - 100) — fine; drop it below 40.
      prisma.product.findUnique.mockResolvedValue({
        ...product,
        inventory: { quantity: 50, reservedQuantity: 20 },
      });
      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toThrow(ConflictException);

      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("404s an address that is not the caller's", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.checkoutResponse("resp-1", "buyer-1", {
          deliveryAddressId: "addr-x",
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("blocks ordering without a verified phone (CP17, same code as cart)", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      prisma.user.findUnique.mockResolvedValue({
        ...buyer,
        phoneVerifiedAt: null,
      });

      await expect(
        service.checkoutResponse("resp-1", "buyer-1", dto),
      ).rejects.toMatchObject({
        response: { code: "PHONE_VERIFICATION_REQUIRED" },
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });
});
