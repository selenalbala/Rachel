import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient, StockMovementType } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();

const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET || "cambia-esta-clave";
const frontendUrl = process.env.FRONTEND_URL || "*";

app.use(helmet());
app.use(cors({
  origin: frontendUrl === "*" ? true : frontendUrl.split(",").map(value => value.trim()),
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

type AuthPayload = { userId: string; email: string };
type AuthRequest = Request & { auth?: AuthPayload };

function getParam(req: Request, name: string): string {
  const value = req.params[name];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Parámetro inválido: ${name}`);
  }

  return value;
}

function asyncRoute(
  handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function auth(req: AuthRequest, res: Response, next: NextFunction): void {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Debes iniciar sesión." });
    return;
  }

  try {
    req.auth = jwt.verify(value.slice(7), jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ message: "La sesión ha caducado." });
  }
}

async function ensureAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || "admin@rachelstudio.es").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "Rachel1234";
  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { name: "Rachel Studio", email, passwordHash }
    });
    console.log(`Usuario administrador creado: ${email}`);
  }
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const clientSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().optional().nullable(),
  email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  birthday: z.union([z.string(), z.null()]).optional(),
  allergies: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const productSchema = z.object({
  name: z.string().trim().min(2),
  brand: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  cost: z.coerce.number().min(0),
  price: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(0),
  minimum: z.coerce.number().int().min(0),
  notes: z.string().optional().nullable()
});

const movementSchema = z.object({
  type: z.nativeEnum(StockMovementType),
  quantity: z.coerce.number().int(),
  reason: z.string().optional().nullable()
}).refine(value => value.quantity !== 0, {
  message: "La cantidad no puede ser cero.",
  path: ["quantity"]
});

app.get("/", (_req, res) => {
  res.json({ name: "Rachel Studio API", status: "ok" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/auth/login", asyncRoute(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const email = data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    res.status(401).json({ message: "Correo o contraseña incorrectos." });
    return;
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email } satisfies AuthPayload,
    jwtSecret,
    { expiresIn: "7d" }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email }
  });
}));

app.get("/auth/me", auth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, name: true, email: true }
  });

  if (!user) {
    res.status(401).json({ message: "Usuario no encontrado." });
    return;
  }

  res.json(user);
}));

app.get("/dashboard", auth, asyncRoute(async (_req, res) => {
  const [clients, products, lowStock] = await Promise.all([
    prisma.client.count(),
    prisma.product.count(),
    prisma.product.count({ where: { quantity: { lte: prisma.product.fields.minimum } } })
  ]);

  res.json({ clients, products, lowStock });
}));

app.get("/clients", auth, asyncRoute(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const clients = await prisma.client.findMany({
    where: search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } }
      ]
    } : undefined,
    orderBy: { name: "asc" }
  });
  res.json(clients);
}));

app.post("/clients", auth, asyncRoute(async (req, res) => {
  const data = clientSchema.parse(req.body);
  const client = await prisma.client.create({
    data: {
      ...data,
      email: data.email || null,
      birthday: data.birthday ? new Date(data.birthday) : null
    }
  });
  res.status(201).json(client);
}));

app.put("/clients/:id", auth, asyncRoute(async (req, res) => {
  const data = clientSchema.parse(req.body);
  const client = await prisma.client.update({
    where: { id: getParam(req, "id") },
    data: {
      ...data,
      email: data.email || null,
      birthday: data.birthday ? new Date(data.birthday) : null
    }
  });
  res.json(client);
}));

app.delete("/clients/:id", auth, asyncRoute(async (req, res) => {
  await prisma.client.delete({ where: { id: getParam(req, "id") } });
  res.status(204).end();
}));

app.get("/products", auth, asyncRoute(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const products = await prisma.product.findMany({
    where: search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { category: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } }
      ]
    } : undefined,
    orderBy: { name: "asc" },
    include: { movements: { take: 10, orderBy: { createdAt: "desc" } } }
  });
  res.json(products);
}));

app.post("/products", auth, asyncRoute(async (req, res) => {
  const data = productSchema.parse(req.body);
  const product = await prisma.product.create({
    data: {
      ...data,
      sku: data.sku?.trim() || null,
      cost: new Prisma.Decimal(data.cost),
      price: new Prisma.Decimal(data.price)
    }
  });

  if (data.quantity > 0) {
    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        type: StockMovementType.ENTRADA,
        quantity: data.quantity,
        reason: "Stock inicial"
      }
    });
  }

  res.status(201).json(product);
}));

app.put("/products/:id", auth, asyncRoute(async (req, res) => {
  const data = productSchema.parse(req.body);
  const current = await prisma.product.findUniqueOrThrow({ where: { id: getParam(req, "id") } });
  const difference = data.quantity - current.quantity;

  const product = await prisma.$transaction(async tx => {
    const updated = await tx.product.update({
      where: { id: getParam(req, "id") },
      data: {
        ...data,
        sku: data.sku?.trim() || null,
        cost: new Prisma.Decimal(data.cost),
        price: new Prisma.Decimal(data.price)
      }
    });

    if (difference !== 0) {
      await tx.stockMovement.create({
        data: {
          productId: updated.id,
          type: StockMovementType.AJUSTE,
          quantity: difference,
          reason: "Edición manual del producto"
        }
      });
    }

    return updated;
  });

  res.json(product);
}));

app.post("/products/:id/movements", auth, asyncRoute(async (req, res) => {
  const data = movementSchema.parse(req.body);
  const signedQuantity =
    data.type === StockMovementType.SALIDA
      ? -Math.abs(data.quantity)
      : data.type === StockMovementType.ENTRADA
        ? Math.abs(data.quantity)
        : data.quantity;

  const result = await prisma.$transaction(async tx => {
    const product = await tx.product.findUniqueOrThrow({ where: { id: getParam(req, "id") } });
    const nextQuantity = product.quantity + signedQuantity;

    if (nextQuantity < 0) {
      throw new Error("No hay suficiente stock para realizar la salida.");
    }

    const updated = await tx.product.update({
      where: { id: product.id },
      data: { quantity: nextQuantity }
    });

    const movement = await tx.stockMovement.create({
      data: {
        productId: product.id,
        type: data.type,
        quantity: signedQuantity,
        reason: data.reason || null
      }
    });

    return { product: updated, movement };
  });

  res.status(201).json(result);
}));

app.delete("/products/:id", auth, asyncRoute(async (req, res) => {
  await prisma.product.delete({ where: { id: getParam(req, "id") } });
  res.status(204).end();
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);

  if (error instanceof z.ZodError) {
    res.status(400).json({
      message: "Revisa los datos introducidos.",
      errors: error.issues
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({ message: "Ya existe un registro con esos datos únicos." });
      return;
    }
    if (error.code === "P2025") {
      res.status(404).json({ message: "Registro no encontrado." });
      return;
    }
  }

  const message = error instanceof Error ? error.message : "Error interno del servidor.";
  res.status(500).json({ message });
});

ensureAdmin()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Rachel Studio API escuchando en el puerto ${port}`);
    });
  })
  .catch(error => {
    console.error("No se pudo iniciar la aplicación:", error);
    process.exit(1);
  });

async function shutdown(): Promise<void> {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);