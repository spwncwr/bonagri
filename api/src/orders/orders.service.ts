import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UserRole } from "../common/types";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { FailDeliveryDto } from "./dto/fail-delivery.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { RedispatchDeliveryDto } from "./dto/redispatch-delivery.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private generateOrderNumber() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.floor(100000 + Math.random() * 900000);

    return `BON-${date}-${suffix}`;
  }

  private async getAllOrdersForAdmin() {
    return this.prisma.order.findMany({
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              include: {
                supplier: true,
                category: true,
              },
            },
          },
        },
        deliveryAddress: true,
        payment: true,
        delivery: {
          include: { transporter: { select: { businessName: true } } },
        },
        invoice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getBuyerOrders(userId: string, role: UserRole) {
    if (role === "ADMIN") {
      return this.getAllOrdersForAdmin();
    }

    const buyer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }

    if (buyer.role !== "BUYER") {
      throw new BadRequestException("User is not a buyer");
    }

    return this.prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                supplier: true,
              },
            },
          },
        },
        deliveryAddress: true,
        payment: true,
        delivery: {
          include: { transporter: { select: { businessName: true } } },
        },
        invoice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getSupplierOrders(userId: string, role: UserRole) {
    if (role === "ADMIN") {
      return this.getAllOrdersForAdmin();
    }

    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        verified: true,
      },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier profile not found");
    }

    return this.prisma.order.findMany({
      where: {
        items: {
          some: {
            product: {
              supplierId: supplier.id,
            },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              include: {
                supplier: true,
                category: true,
              },
            },
          },
        },
        deliveryAddress: true,
        payment: true,
        delivery: {
          include: { transporter: { select: { businessName: true } } },
        },
        invoice: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getOrderDetail(orderId: string, actorUserId: string, actorRole: UserRole) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: {
              include: {
                supplier: true,
                category: true,
              },
            },
          },
        },
        deliveryAddress: true,
        payment: true,
        delivery: {
          include: { transporter: { select: { businessName: true } } },
        },
        invoice: true,
        dispute: true,
        history: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (actorRole === "ADMIN") {
      return order;
    }

    if (actorRole === "BUYER") {
      if (order.userId !== actorUserId) {
        throw new NotFoundException("Order not found");
      }

      return order;
    }

    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId: actorUserId },
      select: { id: true },
    });

    const ownsOrderItem =
      supplier &&
      order.items.some((item) => item.product.supplierId === supplier.id);

    if (!ownsOrderItem) {
      throw new NotFoundException("Order not found");
    }

    return order;
  }

  async createOrder(userId: string, dto: CreateOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          status: true,
        },
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

      const address = await tx.address.findFirst({
        where: {
          id: dto.deliveryAddressId,
          userId,
        },
      });

      if (!address) {
        throw new NotFoundException(
          "Delivery address not found for this buyer",
        );
      }

      const product = await tx.product.findUnique({
        where: { id: dto.productId },
        include: {
          inventory: true,
        },
      });

      if (!product) {
        throw new NotFoundException("Product not found");
      }

      if (product.status !== "ACTIVE") {
        throw new BadRequestException("Product is not available");
      }

      if (!product.inventory) {
        throw new BadRequestException("Product has no inventory record");
      }

      const available =
        product.inventory.quantity - product.inventory.reservedQuantity;

      if (dto.quantity > available) {
        throw new BadRequestException(
          `Only ${available} ${product.unit} available`,
        );
      }

      const subtotal = Number(product.price) * dto.quantity;
      const deliveryFee = 0;
      const total = subtotal + deliveryFee;

      const order = await tx.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          userId,
          deliveryAddressId: dto.deliveryAddressId,
          status: "PENDING",
          subtotal,
          deliveryFee,
          total,
          notes: dto.notes,
          items: {
            create: {
              productId: product.id,
              productName: product.name,
              unitPrice: product.price,
              quantity: dto.quantity,
              lineTotal: subtotal,
            },
          },
        },
        include: {
          items: true,
          deliveryAddress: true,
        },
      });

      await tx.inventory.update({
        where: { productId: product.id },
        data: {
          reservedQuantity: {
            increment: dto.quantity,
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
          note: "Order placed",
        },
      });

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        items: order.items,
        deliveryAddress: order.deliveryAddress,
      };
    });
  }

  async updateOrderStatus(
    orderId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: UpdateOrderStatusDto,
  ) {
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                },
              },
            },
          },
          delivery: { select: { transporterId: true } },
        },
      });

      if (!order) {
        throw new NotFoundException("Order not found");
      }

      const current = order.status;
      const next = dto.status;

      if (actorRole === "BUYER") {
        if (order.userId !== actorUserId) {
          throw new NotFoundException("Order not found");
        }

        if (next !== "CANCELLED" || current !== "PENDING") {
          throw new BadRequestException(
            "Buyers can only cancel their own pending orders",
          );
        }
      } else if (actorRole === "SUPPLIER" || actorRole === "AGRO_DEALER") {
        const supplier = await tx.supplierProfile.findUnique({
          where: { userId: actorUserId },
          select: { id: true },
        });

        if (!supplier) {
          throw new NotFoundException("Supplier profile not found");
        }

        const ownsOrderItem = order.items.some(
          (item) => item.product.supplierId === supplier.id,
        );

        if (!ownsOrderItem) {
          throw new NotFoundException("Order not found");
        }

        if (next === "CANCELLED") {
          throw new BadRequestException(
            "Suppliers cannot cancel buyer orders",
          );
        }

        // CP14 ownership handoff: once a delivery job is claimed, the
        // assigned transporter drives OUT_FOR_DELIVERY and DELIVERED.
        // ADMIN bypasses this (override path).
        if (
          (next === "OUT_FOR_DELIVERY" || next === "DELIVERED") &&
          order.delivery?.transporterId
        ) {
          throw new ForbiddenException(
            "This delivery is assigned to a transporter",
          );
        }
      } else if (actorRole !== "ADMIN") {
        throw new BadRequestException("Unsupported user role");
      }

      const allowedTransitions: Record<string, string[]> = {
        PENDING: ["CONFIRMED", "CANCELLED"],
        CONFIRMED: ["PROCESSING"],
        PROCESSING: ["READY_FOR_DELIVERY"],
        READY_FOR_DELIVERY: ["OUT_FOR_DELIVERY"],
        OUT_FOR_DELIVERY: ["DELIVERED"],
        DELIVERED: [],
        CANCELLED: [],
      };

      if (!allowedTransitions[current]?.includes(next)) {
        throw new BadRequestException(
          `Order cannot move from ${current} to ${next}`,
        );
      }

      // CP12: delivery tracking details ride the OUT_FOR_DELIVERY transition.
      const driverName = dto.driverName?.trim() || undefined;
      const driverPhone = dto.driverPhone?.trim() || undefined;
      const trackingNumber = dto.trackingNumber?.trim() || undefined;
      const estimatedDate = dto.estimatedDate
        ? new Date(dto.estimatedDate)
        : undefined;

      const hasDeliveryDetails =
        driverName !== undefined ||
        driverPhone !== undefined ||
        estimatedDate !== undefined ||
        trackingNumber !== undefined;

      if (hasDeliveryDetails && next !== "OUT_FOR_DELIVERY") {
        throw new BadRequestException(
          "Delivery details can only be set when marking an order out for delivery",
        );
      }

      if (trackingNumber) {
        const existing = await tx.delivery.findUnique({
          where: { trackingNumber },
          select: { orderId: true },
        });

        if (existing && existing.orderId !== orderId) {
          throw new ConflictException(
            "Tracking number is already used by another delivery",
          );
        }
      }

      if (next === "CANCELLED") {
        for (const item of order.items) {
          if (!item.product.inventory) {
            throw new BadRequestException(
              `Inventory record missing for ${item.productName}`,
            );
          }

          const release = await tx.inventory.updateMany({
            where: {
              productId: item.productId,
              reservedQuantity: {
                gte: item.quantity,
              },
            },
            data: {
              reservedQuantity: {
                decrement: item.quantity,
              },
            },
          });

          if (release.count !== 1) {
            throw new BadRequestException(
              `Reserved inventory is insufficient to release ${item.productName}`,
            );
          }
        }
      }

      if (next === "CONFIRMED") {
        for (const item of order.items) {
          const inventory = item.product.inventory;

          if (!inventory) {
            throw new BadRequestException(
              `Inventory record missing for ${item.productName}`,
            );
          }

          if (inventory.reservedQuantity < item.quantity) {
            throw new BadRequestException(
              `Reserved inventory is insufficient for ${item.productName}`,
            );
          }

          await tx.inventory.update({
            where: {
              productId: item.productId,
            },
            data: {
              quantity: {
                decrement: item.quantity,
              },
              reservedQuantity: {
                decrement: item.quantity,
              },
            },
          });
        }

        // CP11: issue the invoice atomically with the first CONFIRMED
        // transition. orderId is unique and update:{} preserves the
        // original numbers, so the write is idempotent.
        await tx.invoice.upsert({
          where: { orderId },
          create: {
            orderId,
            invoiceNumber: `INV-${order.orderNumber}`,
            subtotal: order.subtotal,
            deliveryFee: order.deliveryFee,
            total: order.total,
          },
          update: {},
        });
      }

      // CP12: OUT_FOR_DELIVERY records who is delivering it (ASSIGNED);
      // DELIVERED closes the row out with deliveredAt. Driver fields are
      // partial updates so earlier details survive. CP14: goods are moving,
      // so any published-but-unclaimed job leaves the claim board.
      const outForDeliveryData = {
        status: "ASSIGNED" as const,
        pickedUpAt: new Date(),
        publishedAt: null,
        ...(driverName ? { driverName } : {}),
        ...(driverPhone ? { driverPhone } : {}),
        ...(estimatedDate ? { estimatedDate } : {}),
        ...(trackingNumber ? { trackingNumber } : {}),
      };

      const deliveryUpdate =
        next === "READY_FOR_DELIVERY"
          ? {
              upsert: {
                create: {
                  status: "PENDING" as const,
                },
                update: {
                  status: "PENDING" as const,
                },
              },
            }
          : next === "OUT_FOR_DELIVERY"
            ? {
                upsert: {
                  create: { ...outForDeliveryData },
                  update: { ...outForDeliveryData },
                },
              }
            : next === "DELIVERED"
              ? {
                  upsert: {
                    create: {
                      status: "DELIVERED" as const,
                      deliveredAt: new Date(),
                    },
                    update: {
                      status: "DELIVERED" as const,
                      deliveredAt: new Date(),
                      publishedAt: null,
                    },
                  },
                }
              : undefined;

      const updated = await tx.order.update({
        where: {
          id: orderId,
        },
        data: {
          status: next,
          ...(deliveryUpdate ? { delivery: deliveryUpdate } : {}),
        },
        include: {
          items: true,
          deliveryAddress: true,
          payment: true,
          delivery: {
            include: { transporter: { select: { businessName: true } } },
          },
          invoice: true,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: current,
          toStatus: next,
          actorUserId,
          actorRole,
          note: null,
        },
      });

      return updated;
    });

    // Notification rows + emails fire after the transaction commits
    // (CP6); the hook never throws into the transition.
    await this.notificationsService.onOrderStatusChanged(updatedOrder);

    return updatedOrder;
  }

  // CP11: the buyer records manual EFT evidence against a pending order.
  // The row is evidence only - it never moves the order status itself.
  async recordPayment(orderId: string, userId: string, dto: RecordPaymentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException("Order not found");
    }

    if (order.status !== "PENDING") {
      throw new ConflictException(
        "EFT payment can only be recorded while the order is pending",
      );
    }

    const transactionRef = dto.transactionRef.trim();

    if (transactionRef.length < 3) {
      throw new BadRequestException(
        "Transaction reference must be at least 3 characters",
      );
    }

    if (order.payment) {
      if (order.payment.status === "PENDING") {
        throw new ConflictException(
          "Payment already recorded for this order and is awaiting supplier verification",
        );
      }

      if (order.payment.status === "PAID") {
        throw new ConflictException(
          "Payment for this order has already been verified",
        );
      }

      // FAILED: the buyer is re-recording with a corrected reference.
      return this.prisma.payment.update({
        where: { id: order.payment.id },
        data: {
          status: "PENDING",
          transactionRef,
          paidAt: null,
        },
      });
    }

    return this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "MANUAL",
        status: "PENDING",
        amount: order.total,
        transactionRef,
      },
    });
  }

  // CP11: the supplier of the order decides on the recorded evidence.
  // Payment is evidence, not authority - the order only advances through
  // updateOrderStatus.
  async updatePayment(
    orderId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: VerifyPaymentDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        items: { select: { product: { select: { supplierId: true } } } },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (actorRole === "SUPPLIER" || actorRole === "AGRO_DEALER") {
      const supplier = await this.prisma.supplierProfile.findUnique({
        where: { userId: actorUserId },
        select: { id: true },
      });

      if (!supplier) {
        throw new NotFoundException("Supplier profile not found");
      }

      const ownsOrder = order.items.some(
        (item) => item.product.supplierId === supplier.id,
      );

      if (!ownsOrder) {
        throw new NotFoundException("Order not found");
      }
    } else if (actorRole !== "ADMIN") {
      throw new BadRequestException("Unsupported user role");
    }

    if (!order.payment) {
      throw new ConflictException("No payment has been recorded for this order");
    }

    if (order.payment.status === "PAID") {
      throw new ConflictException(
        "Payment for this order has already been verified",
      );
    }

    if (order.payment.status === "FAILED" && dto.status === "FAILED") {
      throw new ConflictException(
        "Payment for this order has already been rejected",
      );
    }

    const payment = await this.prisma.payment.update({
      where: { id: order.payment.id },
      data: {
        status: dto.status,
        paidAt: dto.status === "PAID" ? new Date() : null,
      },
    });

    // Notification rows + emails fire after the write commits; the hook
    // never throws into the decision (CP6/CP11 house pattern).
    await this.notificationsService.onPaymentDecision(
      { orderNumber: order.orderNumber, userId: order.userId },
      dto.status,
    );

    return payment;
  }

  // CP12: tracking view for the order's delivery — buyer owner, a supplier
  // of one of its items, or an admin; everyone else sees 404.
  async getDelivery(orderId: string, actorUserId: string, actorRole: UserRole) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        delivery: {
          include: { transporter: { select: { businessName: true } } },
        },
        items: { select: { product: { select: { supplierId: true } } } },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (actorRole === "BUYER") {
      if (order.userId !== actorUserId) {
        throw new NotFoundException("Order not found");
      }
    } else if (actorRole === "SUPPLIER" || actorRole === "AGRO_DEALER") {
      const supplier = await this.prisma.supplierProfile.findUnique({
        where: { userId: actorUserId },
        select: { id: true },
      });

      const ownsOrder =
        !!supplier &&
        order.items.some((item) => item.product.supplierId === supplier.id);

      if (!ownsOrder) {
        throw new NotFoundException("Order not found");
      }
    } else if (actorRole === "TRANSPORTER") {
      // CP14: the assigned transporter sees the delivery view — full
      // pickup/dropoff details + buyer contact. Everyone else 404s.
      const profile = await this.prisma.transporterProfile.findUnique({
        where: { userId: actorUserId },
        select: { id: true },
      });

      if (!profile || order.delivery?.transporterId !== profile.id) {
        throw new NotFoundException("Order not found");
      }
    } else if (actorRole !== "ADMIN") {
      throw new BadRequestException("Unsupported user role");
    }

    if (!order.delivery) {
      throw new NotFoundException(
        "No delivery tracking exists for this order yet",
      );
    }

    return order.delivery;
  }

  // CP14: shared access check for the supplier/admin delivery-job actions
  // (publish / unpublish / re-dispatch). Foreign suppliers see 404.
  private async loadDeliveryJobOrder(
    orderId: string,
    actorUserId: string,
    actorRole: UserRole,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        delivery: {
          include: { transporter: { select: { businessName: true } } },
        },
        items: { select: { product: { select: { supplierId: true } } } },
        deliveryAddress: { select: { province: true } },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (actorRole === "SUPPLIER" || actorRole === "AGRO_DEALER") {
      const supplier = await this.prisma.supplierProfile.findUnique({
        where: { userId: actorUserId },
        select: { id: true },
      });

      const ownsOrder =
        !!supplier &&
        order.items.some((item) => item.product.supplierId === supplier.id);

      if (!ownsOrder) {
        throw new NotFoundException("Order not found");
      }
    } else if (actorRole !== "ADMIN") {
      throw new BadRequestException("Unsupported user role");
    }

    return order;
  }

  // CP14: publish the delivery job to the verified transporters' claim
  // board. Allowed at READY_FOR_DELIVERY, or as a re-publish after a
  // FAILED delivery was returned to the board (order already OUT).
  async publishDelivery(
    orderId: string,
    actorUserId: string,
    actorRole: UserRole,
  ) {
    const order = await this.loadDeliveryJobOrder(
      orderId,
      actorUserId,
      actorRole,
    );

    const isRePublish =
      order.status === "OUT_FOR_DELIVERY" &&
      order.delivery?.status === "PENDING" &&
      !order.delivery?.transporterId;

    if (order.status !== "READY_FOR_DELIVERY" && !isRePublish) {
      throw new BadRequestException(
        "Delivery jobs can only be published when the order is ready for delivery",
      );
    }

    if (
      order.delivery &&
      (order.delivery.status !== "PENDING" || order.delivery.transporterId)
    ) {
      throw new ConflictException(
        "This delivery is already claimed or in progress",
      );
    }

    if (order.delivery?.publishedAt) {
      throw new ConflictException(
        "This delivery job is already on the claim board",
      );
    }

    const publishedAt = new Date();

    const delivery = await this.prisma.delivery.upsert({
      where: { orderId },
      create: { orderId, status: "PENDING", publishedAt },
      update: { status: "PENDING", publishedAt },
    });

    // Fan-out rows go to verified transporters covering the delivery
    // province (all verified transporters when the province is unknown —
    // those jobs are board-visible to everyone).
    const province = order.deliveryAddress.province;
    const transporters = await this.prisma.transporterProfile.findMany({
      where: {
        verified: true,
        ...(province ? { serviceProvinces: { has: province } } : {}),
      },
      select: {
        user: { select: { id: true, email: true, firstName: true } },
      },
    });

    try {
      await this.notificationsService.onDeliveryJobPublished(
        order.orderNumber,
        province,
        transporters.map((transporter) => transporter.user),
      );
    } catch (error) {
      console.error("BonAgri publish notification failed:", error);
    }

    return delivery;
  }

  async unpublishDelivery(
    orderId: string,
    actorUserId: string,
    actorRole: UserRole,
  ) {
    const order = await this.loadDeliveryJobOrder(
      orderId,
      actorUserId,
      actorRole,
    );

    if (!order.delivery || !order.delivery.publishedAt) {
      throw new ConflictException(
        "This delivery job is not on the claim board",
      );
    }

    if (order.delivery.status !== "PENDING" || order.delivery.transporterId) {
      throw new ConflictException(
        "A transporter already claimed this delivery job",
      );
    }

    return this.prisma.delivery.update({
      where: { orderId },
      data: { publishedAt: null },
    });
  }

  // CP14: move a FAILED delivery back into circulation — either straight to
  // a specific (verified) transporter or back to the unclaimed board state
  // (supplier re-publishes or delivers it himself). The order status never
  // moves backwards anywhere in this flow.
  async redispatchDelivery(
    orderId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: RedispatchDeliveryDto,
  ) {
    const order = await this.loadDeliveryJobOrder(
      orderId,
      actorUserId,
      actorRole,
    );

    if (!order.delivery || order.delivery.status !== "FAILED") {
      throw new ConflictException(
        "Only a failed delivery can be re-dispatched",
      );
    }

    if (dto.transporterId) {
      const target = await this.prisma.transporterProfile.findUnique({
        where: { id: dto.transporterId },
        select: {
          id: true,
          verified: true,
          user: { select: { id: true, email: true, firstName: true } },
        },
      });

      if (!target) {
        throw new NotFoundException("Transporter not found");
      }

      if (!target.verified) {
        throw new BadRequestException(
          "Only verified transporters can carry deliveries",
        );
      }

      const updated = await this.prisma.delivery.update({
        where: { orderId },
        data: { status: "ASSIGNED", transporterId: target.id },
        include: {
          order: { select: { orderNumber: true, status: true } },
        },
      });

      try {
        await this.notificationsService.onDeliveryReassignedToTransporter(
          target.user,
          order.orderNumber,
        );
      } catch (error) {
        console.error("BonAgri re-dispatch notification failed:", error);
      }

      return updated;
    }

    return this.prisma.delivery.update({
      where: { orderId },
      data: { status: "PENDING", transporterId: null, publishedAt: null },
    });
  }

  // CP14: the assigned transporter drives the delivery state machine.
  // Each action re-checks ownership and the delivery's current state;
  // order transitions (pickup/complete) ride the same transaction as the
  // delivery write and record OrderStatusHistory like every other flip.
  async deliveryAction(
    orderId: string,
    actorUserId: string,
    action: "pickup" | "transit" | "complete" | "fail",
    dto?: FailDeliveryDto,
  ) {
    const profile = await this.prisma.transporterProfile.findUnique({
      where: { userId: actorUserId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException("Transporter profile not found");
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { delivery: true },
    });

    if (
      !order ||
      !order.delivery ||
      order.delivery.transporterId !== profile.id
    ) {
      throw new NotFoundException("Delivery job not found");
    }

    const delivery = order.delivery;

    const allowedByAction: Record<string, string[]> = {
      pickup: ["ASSIGNED"],
      transit: ["PICKED_UP"],
      complete: ["PICKED_UP", "IN_TRANSIT"],
      fail: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"],
    };

    if (!allowedByAction[action].includes(delivery.status)) {
      throw new ConflictException(
        `A delivery in state ${delivery.status} cannot do this action`,
      );
    }

    const now = new Date();

    if (action === "pickup") {
      // Re-dispatch after a delivery failure: the order already left the
      // supplier, so only the delivery state moves.
      const orderAlreadyOut = order.status === "OUT_FOR_DELIVERY";

      if (!orderAlreadyOut && order.status !== "READY_FOR_DELIVERY") {
        throw new ConflictException(
          `Order cannot move from ${order.status} to OUT_FOR_DELIVERY`,
        );
      }

      const pickedUp = await this.prisma.$transaction(async (tx) => {
        const updatedDelivery = await tx.delivery.update({
          where: { orderId },
          data: {
            status: "PICKED_UP",
            // Stamp once — a re-dispatched retry keeps the original time.
            pickedUpAt: delivery.pickedUpAt ?? now,
          },
        });

        if (!orderAlreadyOut) {
          await tx.order.update({
            where: { id: orderId },
            data: { status: "OUT_FOR_DELIVERY" },
          });

          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: "READY_FOR_DELIVERY",
              toStatus: "OUT_FOR_DELIVERY",
              actorUserId,
              actorRole: "TRANSPORTER",
              note: null,
            },
          });
        }

        return updatedDelivery;
      });

      if (!orderAlreadyOut) {
        try {
          await this.notificationsService.onDeliveryPickedUp({
            orderNumber: order.orderNumber,
            userId: order.userId,
          });
        } catch (error) {
          console.error("BonAgri pickup notification failed:", error);
        }
      }

      return pickedUp;
    }

    if (action === "transit") {
      return this.prisma.delivery.update({
        where: { orderId },
        data: { status: "IN_TRANSIT" },
      });
    }

    if (action === "complete") {
      if (order.status !== "OUT_FOR_DELIVERY") {
        throw new ConflictException(
          `Order cannot move from ${order.status} to DELIVERED`,
        );
      }

      const completed = await this.prisma.$transaction(async (tx) => {
        const updatedDelivery = await tx.delivery.update({
          where: { orderId },
          data: {
            status: "DELIVERED",
            deliveredAt: now,
            publishedAt: null,
          },
        });

        await tx.order.update({
          where: { id: orderId },
          data: { status: "DELIVERED" },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: "OUT_FOR_DELIVERY",
            toStatus: "DELIVERED",
            actorUserId,
            actorRole: "TRANSPORTER",
            note: null,
          },
        });

        return updatedDelivery;
      });

      // Existing CP6 hook: DELIVERED → buyer notification row + email.
      try {
        await this.notificationsService.onOrderStatusChanged({
          id: order.id,
          orderNumber: order.orderNumber,
          status: "DELIVERED",
          userId: order.userId,
        });
      } catch (error) {
        console.error("BonAgri delivered notification failed:", error);
      }

      return completed;
    }

    // fail — the order never moves; the reason is the audit trail.
    const failed = await this.prisma.delivery.update({
      where: { orderId },
      data: {
        status: "FAILED",
        failedReason: dto?.reason?.trim() || "No reason given",
        failedAt: now,
      },
    });

    try {
      await this.notificationsService.onDeliveryFailed(
        {
          id: order.id,
          orderNumber: order.orderNumber,
          userId: order.userId,
        },
        failed.failedReason ?? "",
      );
    } catch (error) {
      console.error("BonAgri delivery-failed notification failed:", error);
    }

    return failed;
  }
}
