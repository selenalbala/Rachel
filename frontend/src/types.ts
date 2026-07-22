export type Client = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  allergies: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockMovement = {
  id: string;
  type: "ENTRADA" | "SALIDA" | "AJUSTE";
  quantity: number;
  reason: string | null;
  createdAt: string;
};

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  supplier: string | null;
  sku: string | null;
  cost: string | number;
  price: string | number;
  quantity: number;
  minimum: number;
  notes: string | null;
  movements?: StockMovement[];
};

export type User = {
  id: string;
  name: string;
  email: string;
};
