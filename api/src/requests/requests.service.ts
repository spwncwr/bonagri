import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertPhoneVerified } from "../verification/verification.permissions";
import {
  buildDeliverySnapshot,
  materializeDeliveryAddress,
} from "../common/delivery-snapshot";
import { CheckoutDto } from "../cart/dto/checkout.dto";
import { CreateProductRequestDto } from "./dto/create-product-request.dto";
import { UpdateProductRequestDto } from "./dto/update-product-request.dto";
import { CreateRequestResponseDto } from "./dto/create-request-response.dto";
import { UpdateRequestResponseDto } from "./dto/update-request-response.dto";

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(buyerId: string, dto: CreateProductRequestDto) {
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: { id: true },
      });

      if (!category) {
        throw new BadRequestException("Category not found");
      }
    }

    if (dto.requiredBy) {
      const requiredBy = new Date(dto.requiredBy);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      if (requiredBy < startOfToday) {
        throw new BadRequestException(
          "requiredBy cannot be in the past",
        );
      }
    }

    return this.prisma.productRequest.create({
      data: {
        buyerId,
        title: dto.title.trim(),
        categoryId: dto.categoryId ?? null,
        quantity: dto.quantity,
        unit: dto.unit.trim(),
        destinationCity: dto.destinationCity?.trim() || null,
        requiredBy: dto.requiredBy ? new Date(dto.requiredBy) : null,
        notes: dto.notes?.trim() || null,
      },
      include: {
        category: { select: { name: true, slug: true } },
      },
    });
  }

  // Public demand board: OPEN requests only, newest first. Explicit
  // select - never expose buyerId or any buyer identity here (Prisma
  // scalars like buyerId leak unless excluded).
  async listOpen() {
    return this.prisma.productRequest.findMany({
      where: { status: "OPEN" },
      select: {
        id: true,
        title: true,
        quantity: true,
        unit: true,
        destinationCity: true,
        requiredBy: true,
        notes: true,
        createdAt: true,
        category: { select: { name: true, slug: true } },
        // Landing badge: how many suppliers are interested (count only).
        _count: {
          select: {
            responses: { where: { status: { in: ["OPEN", "ACCEPTED"] } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getMine(userId: string) {
    return this.prisma.productRequest.findMany({
      where: { buyerId: userId },
      include: {
        category: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateProductRequestDto,
  ) {
    const request = await this.prisma.productRequest.findUnique({
      where: { id },
      select: { id: true, buyerId: true, status: true },
    });

    // Foreign requests 404 so ids cannot be probed.
    if (!request || request.buyerId !== userId) {
      throw new NotFoundException("Product request not found");
    }

    if (request.status !== "OPEN") {
      throw new ConflictException(
        `Request is already ${request.status.toLowerCase()}`,
      );
    }

    return this.prisma.productRequest.update({
      where: { id },
      data: { status: dto.status },
      include: {
        category: { select: { name: true, slug: true } },
      },
    });
  }

  async respond(
    requestId: string,
    userId: string,
    dto: CreateRequestResponseDto,
  ) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new ForbiddenException("No supplier profile for this account");
    }

    const request = await this.prisma.productRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true },
    });

    if (!request) {
      throw new NotFoundException("Product request not found");
    }

    if (request.status !== "OPEN") {
      throw new ConflictException(
        `Request is already ${request.status.toLowerCase()}`,
      );
    }

    // F1: the quote must reference one of this supplier's ACTIVE listings —
    // that product is what the accepted quote converts into an order for.
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        supplierId: profile.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    if (!product) {
      throw new BadRequestException(
        "Quote must reference one of your active products",
      );
    }

    const duplicate = await this.prisma.requestResponse.findUnique({
      where: {
        requestId_supplierId: { requestId, supplierId: profile.id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException("You already responded to this request");
    }

    return this.prisma.requestResponse.create({
      data: {
        requestId,
        supplierId: profile.id,
        productId: product.id,
        message: dto.message.trim(),
        quotedPrice: dto.quotedPrice ?? null,
        quotedUnit: dto.quotedUnit?.trim() || null,
      },
      select: {
        id: true,
        status: true,
        message: true,
        productId: true,
        orderId: true,
        quotedPrice: true,
        quotedUnit: true,
        createdAt: true,
        product: { select: { id: true, name: true, unit: true, price: true } },
      },
    });
  }

  // Buyer-owner reads responses to their own request; foreign ids 404 alike.
  async listResponses(requestId: string, userId: string) {
    const request = await this.prisma.productRequest.findUnique({
      where: { id: requestId },
      select: { id: true, buyerId: true },
    });

    if (!request || request.buyerId !== userId) {
      throw new NotFoundException("Product request not found");
    }

    return this.prisma.requestResponse.findMany({
      where: { requestId },
      select: {
        id: true,
        message: true,
        productId: true,
        orderId: true,
        quotedPrice: true,
        quotedUnit: true,
        status: true,
        createdAt: true,
        product: { select: { id: true, name: true, unit: true, price: true } },
        supplier: {
          select: {
            businessName: true,
            city: true,
            verified: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async listMyResponses(userId: string) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new ForbiddenException("No supplier profile for this account");
    }

    return this.prisma.requestResponse.findMany({
      where: { supplierId: profile.id },
      select: {
        id: true,
        status: true,
        message: true,
        productId: true,
        orderId: true,
        quotedPrice: true,
        quotedUnit: true,
        createdAt: true,
        product: { select: { id: true, name: true, unit: true, price: true } },
        request: {
          select: {
            id: true,
            title: true,
            quantity: true,
            unit: true,
            destinationCity: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async updateResponse(
    responseId: string,
    userId: string,
    dto: UpdateRequestResponseDto,
  ) {
    const response = await this.prisma.requestResponse.findUnique({
      where: { id: responseId },
      select: {
        id: true,
        status: true,
        requestId: true,
        supplier: {
          select: {
            userId: true,
            businessName: true,
            user: {
              select: { id: true, email: true, firstName: true },
            },
          },
        },
        request: {
          select: { id: true, title: true, buyerId: true },
        },
      },
    });

    // Withdraw = vendor-only; accept/decline = buyer-owner-only; both 404
    // for anyone else so ids cannot be probed.
    const isVendorWithdraw =
      dto.status === "WITHDRAWN" && response?.supplier.userId === userId;
    const isBuyerDecision =
      (dto.status === "ACCEPTED" || dto.status === "DECLINED") &&
      response?.request.buyerId === userId;

    if (!response || (!isVendorWithdraw && !isBuyerDecision)) {
      throw new NotFoundException("Response not found");
    }

    if (response.status !== "OPEN") {
      throw new ConflictException(
        `Response is already ${response.status.toLowerCase()}`,
      );
    }

    if (dto.status === "ACCEPTED") {
      // Accepting wins the request: every other live response closes.
      const [, updated] = await this.prisma.$transaction([
        this.prisma.requestResponse.updateMany({
          where: {
            requestId: response.requestId,
            status: "OPEN",
            id: { not: responseId },
          },
          data: { status: "DECLINED" },
        }),
        this.prisma.requestResponse.update({
          where: { id: responseId },
          data: { status: "ACCEPTED" },
        }),
      ]);

      // The decision is committed; telling the vendor is best-effort.
      try {
        await this.notificationsService.onRequestResponseAccepted(
          response.supplier.user,
          response.request.title,
        );
      } catch (error) {
        console.error("BonAgri request-response notification failed:", error);
      }

      return updated;
    }

    return this.prisma.requestResponse.update({
      where: { id: responseId },
      data: { status: dto.status },
    });
  }

  // F1: convert an ACCEPTED, product-backed quote into a PENDING order at
  // the agreed price. Direct creation (not a cart token) — the cart is
  // product-keyed and server-priced, so it cannot carry an agreed price.
  // Mirrors CartService.checkout's gates (buyer/phone/address/inventory)
  // but prices the single OrderItem at quotedPrice and claims the quote
  // atomically (orderId @unique + guarded updateMany) so a double-submit
  // or race can never place two orders for one quote.
  async checkoutResponse(responseId: string, userId: string, dto: CheckoutDto) {
    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, status: true, phoneVerifiedAt: true },
      });

      if (!buyer) {
        throw new NotFoundException("Buyer not found");
      }

      if (buyer.role !== "BUYER") {
        throw new BadRequestException("User is not a buyer");
      }

      if (buyer.status !== "ACTIVE") {
        throw new BadRequestException("Buyer account is not active");
      }

      // Ownership first: a foreign or unknown quote is a flat 404 with no
      // existence leak, decided before any caller precondition below —
      // a stranger learns nothing about the quote (or what gates it).
      const response = await tx.requestResponse.findUnique({
        where: { id: responseId },
        select: {
          id: true,
          status: true,
          orderId: true,
          productId: true,
          quotedPrice: true,
          supplierId: true,
          request: {
            select: { buyerId: true, quantity: true, unit: true },
          },
        },
      });

      // Foreign or unknown quotes 404 alike — no existence leak.
      if (!response || response.request.buyerId !== userId) {
        throw new NotFoundException("Quote not found");
      }

      // CP17: same gate as cart checkout — ordering needs a confirmed phone.
      assertPhoneVerified(buyer);

      const address = await tx.address.findFirst({
        where: { id: dto.deliveryAddressId, userId },
      });

      if (!address) {
        throw new NotFoundException(
          "Delivery address not found for this buyer",
        );
      }

      // The orderId guard is the conversion lock: @unique + updateMany
      // below make the claim race-safe, this check just fails fast.
      if (response.orderId) {
        throw new ConflictException(
          "This quote has already been converted to an order",
        );
      }

      if (response.status !== "ACCEPTED") {
        throw new ConflictException(
          `Quote is ${response.status.toLowerCase()} — only accepted quotes can be ordered`,
        );
      }

      // Pre-F1 rows (nullable productId) and price-less quotes cannot
      // become orders: there is nothing to price or reserve.
      if (!response.productId || response.quotedPrice === null) {
        throw new ConflictException(
          "This quote cannot be converted to an order",
        );
      }

      const product = await tx.product.findUnique({
        where: { id: response.productId },
        select: {
          id: true,
          name: true,
          unit: true,
          status: true,
          supplierId: true,
          supplier: { select: { businessName: true } },
          inventory: {
            select: { quantity: true, reservedQuantity: true },
          },
        },
      });

      if (!product || product.supplierId !== response.supplierId) {
        throw new ConflictException(
          "The quoted product is no longer available",
        );
      }

      if (product.status !== "ACTIVE") {
        throw new ConflictException(`${product.name} is no longer available`);
      }

      const quantity = response.request.quantity;
      const available = product.inventory
        ? product.inventory.quantity - product.inventory.reservedQuantity
        : 0;

      if (quantity > available) {
        throw new ConflictException(
          `Only ${available} ${product.unit} of ${product.name} available`,
        );
      }

      // Server-priced at the agreed figure — never the catalog price.
      const unitPrice = Number(response.quotedPrice);
      const subtotal = unitPrice * quantity;
      const deliveryFee = 0;
      const total = subtotal + deliveryFee;

      const order = await tx.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          userId,
          deliveryAddressId: dto.deliveryAddressId,
          // Immutable destination snapshot (see common/delivery-snapshot).
          deliverySnapshot: buildDeliverySnapshot(address),
          status: "PENDING",
          subtotal,
          deliveryFee,
          total,
          notes: dto.notes,
          items: {
            create: [
              {
                productId: product.id,
                productName: product.name,
                unitPrice,
                quantity,
                lineTotal: subtotal,
              },
            ],
          },
        },
        include: {
          items: true,
          deliveryAddress: true,
        },
      });

      // Claim the quote: only wins while orderId is still null, so a
      // concurrent submit rolls back its freshly created order above.
      const claimed = await tx.requestResponse.updateMany({
        where: { id: responseId, orderId: null },
        data: { orderId: order.id },
      });

      if (claimed.count !== 1) {
        throw new ConflictException(
          "This quote has already been converted to an order",
        );
      }

      await tx.inventory.update({
        where: { productId: product.id },
        data: {
          reservedQuantity: {
            increment: quantity,
          },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "PENDING",
          actorUserId: userId,
          actorRole: "BUYER",
          note: "Order placed from accepted quote",
        },
      });

      // Same shape as cart checkout's orders[] so the payment screen's
      // PlacedOrder rendering works unchanged (no orderGroupId: single
      // order per quote).
      return {
        orderCount: 1,
        orders: [
          {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            subtotal: order.subtotal,
            deliveryFee: order.deliveryFee,
            total: order.total,
            supplierName: product.supplier.businessName,
            items: order.items,
            deliveryAddress: materializeDeliveryAddress(order),
          },
        ],
      };
    });
  }

  // Mirrors OrdersService/CartService.generateOrderNumber (kept local per
  // the same precedent; same BON-YYYYMMDD-NNNNNN format).
  private generateOrderNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.floor(100000 + Math.random() * 900000);

    return `BON-${date}-${suffix}`;
  }
}
