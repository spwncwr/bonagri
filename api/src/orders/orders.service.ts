import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UserRole } from "../common/types";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
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
        delivery: true,
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
        delivery: true,
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
        delivery: true,
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
        delivery: true,
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
      // partial updates so earlier details survive.
      const outForDeliveryData = {
        status: "ASSIGNED" as const,
        pickedUpAt: new Date(),
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
          delivery: true,
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
        delivery: true,
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
}
