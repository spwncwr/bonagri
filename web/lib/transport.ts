export type Job = {
  orderId: string;
  orderNumber: string;
  pickupCity: string | null;
  supplierBusinessName: string | null;
  dropoffCity: string | null;
  dropoffProvince: string | null;
  itemCount: number;
  publishedAt: string | null;
};

export type DeliveryOrder = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  total: string;
  items: {
    quantity: number;
    product: {
      name: string;
      supplier?: {
        businessName: string | null;
        city: string | null;
        province: string | null;
        lat: number | null;
        lng: number | null;
      } | null;
    };
  }[];
  deliveryAddress: {
    recipientName: string;
    addressLine1: string;
    city: string;
    province: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
  };
  user: { firstName: string; lastName: string; phone: string | null };
};

export type Delivery = {
  id: string;
  orderId: string;
  status: "ASSIGNED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "FAILED";
  trackingNumber: string | null;
  estimatedDate: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failedReason: string | null;
  failedAt: string | null;
  order: DeliveryOrder;
};
