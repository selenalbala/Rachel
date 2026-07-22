import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  AppointmentStatus,
  Prisma,
  PrismaClient,
  ProductUnit,
  StockMovementType
} from "@prisma/client";
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
app.use(express.json({ limit: "5mb" }));
app.use(morgan("combined"));

type AuthPayload = { userId: string; email: string };
type AuthRequest = Request & { auth?: AuthPayload };

function asyncRoute(handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => handler(req, res, next).catch(next);
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Parámetro inválido: ${name}`);
  return value;
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
    await prisma.user.create({ data: { name: "Rachel Studio", email, passwordHash: await bcrypt.hash(password, 12) } });
    console.log(`Usuario administrador creado: ${email}`);
  }
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const clientSchema = z.object({
  name: z.string().trim().min(2), phone: z.string().optional().nullable(), email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  birthday: z.union([z.string(), z.null()]).optional(), allergies: z.string().optional().nullable(), notes: z.string().optional().nullable(), colorFormula: z.string().optional().nullable()
});
const employeeSchema = z.object({
  name: z.string().trim().min(2), specialty: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.union([z.string().email(), z.literal(""), z.null()]).optional(), color: z.string().default("#EC4899"), active: z.boolean().default(true)
});
const serviceSchema = z.object({
  name: z.string().trim().min(2), category: z.string().optional().nullable(), description: z.string().optional().nullable(), durationMin: z.coerce.number().int().min(5), price: z.coerce.number().min(0), color: z.string().default("#F9A8D4"), active: z.boolean().default(true)
});
const productSchema = z.object({
  name: z.string().trim().min(2), brand: z.string().optional().nullable(), category: z.string().optional().nullable(), supplier: z.string().optional().nullable(), sku: z.string().optional().nullable(),
  unit: z.nativeEnum(ProductUnit), packageSize: z.coerce.number().min(0).optional().nullable(), quantity: z.coerce.number().min(0), minimum: z.coerce.number().min(0), cost: z.coerce.number().min(0), price: z.coerce.number().min(0), notes: z.string().optional().nullable(), active: z.boolean().default(true)
});
const movementSchema = z.object({
  type: z.nativeEnum(StockMovementType), quantity: z.coerce.number().refine(v => v !== 0, "La cantidad no puede ser cero."), reason: z.string().optional().nullable(), appointmentId: z.string().optional().nullable()
});
const appointmentSchema = z.object({
  clientId: z.string().min(1), employeeId: z.string().min(1), startsAt: z.string().datetime(), status: z.nativeEnum(AppointmentStatus).default(AppointmentStatus.PENDIENTE), notes: z.string().optional().nullable(), paid: z.boolean().default(false),
  services: z.array(z.object({ serviceId: z.string().min(1), discount: z.coerce.number().min(0).max(100).default(0) })).min(1),
  products: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().positive() })).default([])
});

app.get("/", (_req, res) => res.json({ name: "Rachel Studio API", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/auth/login", asyncRoute(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    res.status(401).json({ message: "Correo o contraseña incorrectos." });
    return;
  }
  const token = jwt.sign({ userId: user.id, email: user.email } satisfies AuthPayload, jwtSecret, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
}));

app.get("/auth/me", auth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, name: true, email: true } });
  if (!user) { res.status(401).json({ message: "Usuario no encontrado." }); return; }
  res.json(user);
}));

app.get("/dashboard", auth, asyncRoute(async (_req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const [clients, products, allProducts, todayAppointments, monthAppointments, nextAppointment] = await Promise.all([
    prisma.client.count(), prisma.product.count({ where: { active: true } }), prisma.product.findMany({ where: { active: true } }),
    prisma.appointment.findMany({ where: { startsAt: { gte: start, lt: end }, status: { not: AppointmentStatus.CANCELADA } }, include: { client: true, employee: true, services: true }, orderBy: { startsAt: "asc" } }),
    prisma.appointment.findMany({ where: { startsAt: { gte: monthStart }, status: AppointmentStatus.FINALIZADA }, select: { total: true } }),
    prisma.appointment.findFirst({ where: { startsAt: { gte: new Date() }, status: { in: [AppointmentStatus.PENDIENTE, AppointmentStatus.CONFIRMADA] } }, include: { client: true, employee: true, services: true }, orderBy: { startsAt: "asc" } })
  ]);
  const lowProducts = allProducts.filter(p => Number(p.quantity) <= Number(p.minimum));
  const todayRevenue = todayAppointments.filter(a => a.status === AppointmentStatus.FINALIZADA).reduce((sum, a) => sum + Number(a.total), 0);
  const monthRevenue = monthAppointments.reduce((sum, a) => sum + Number(a.total), 0);
  res.json({ clients, products, lowStock: lowProducts.length, lowProducts: lowProducts.slice(0, 5), todayAppointments, todayRevenue, monthRevenue, nextAppointment });
}));

// CLIENTAS
app.get("/clients", auth, asyncRoute(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const clients = await prisma.client.findMany({
    where: search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : undefined,
    orderBy: { name: "asc" }
  });
  res.json(clients);
}));
app.get("/clients/:id", auth, asyncRoute(async (req, res) => {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: param(req, "id") }, include: { appointments: { include: { employee: true, services: true, products: { include: { product: true } } }, orderBy: { startsAt: "desc" } } } });
  res.json(client);
}));
app.post("/clients", auth, asyncRoute(async (req, res) => {
  const data = clientSchema.parse(req.body);
  res.status(201).json(await prisma.client.create({ data: { ...data, email: data.email || null, birthday: data.birthday ? new Date(data.birthday) : null } }));
}));
app.put("/clients/:id", auth, asyncRoute(async (req, res) => {
  const data = clientSchema.parse(req.body);
  res.json(await prisma.client.update({ where: { id: param(req, "id") }, data: { ...data, email: data.email || null, birthday: data.birthday ? new Date(data.birthday) : null } }));
}));
app.delete("/clients/:id", auth, asyncRoute(async (req, res) => { await prisma.client.delete({ where: { id: param(req, "id") } }); res.status(204).end(); }));

// EMPLEADAS
app.get("/employees", auth, asyncRoute(async (_req, res) => res.json(await prisma.employee.findMany({ orderBy: { name: "asc" } }))));
app.post("/employees", auth, asyncRoute(async (req, res) => { const data = employeeSchema.parse(req.body); res.status(201).json(await prisma.employee.create({ data: { ...data, email: data.email || null } })); }));
app.put("/employees/:id", auth, asyncRoute(async (req, res) => { const data = employeeSchema.parse(req.body); res.json(await prisma.employee.update({ where: { id: param(req, "id") }, data: { ...data, email: data.email || null } })); }));
app.delete("/employees/:id", auth, asyncRoute(async (req, res) => { await prisma.employee.update({ where: { id: param(req, "id") }, data: { active: false } }); res.status(204).end(); }));

// SERVICIOS
app.get("/services", auth, asyncRoute(async (_req, res) => res.json(await prisma.service.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }))));
app.post("/services", auth, asyncRoute(async (req, res) => { const data = serviceSchema.parse(req.body); res.status(201).json(await prisma.service.create({ data: { ...data, price: new Prisma.Decimal(data.price) } })); }));
app.put("/services/:id", auth, asyncRoute(async (req, res) => { const data = serviceSchema.parse(req.body); res.json(await prisma.service.update({ where: { id: param(req, "id") }, data: { ...data, price: new Prisma.Decimal(data.price) } })); }));
app.delete("/services/:id", auth, asyncRoute(async (req, res) => { await prisma.service.update({ where: { id: param(req, "id") }, data: { active: false } }); res.status(204).end(); }));

// PRODUCTOS Y STOCK
app.get("/products", auth, asyncRoute(async (req, res) => {
  const search = String(req.query.search || "").trim();
  res.json(await prisma.product.findMany({ where: search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { brand: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } : undefined, orderBy: { name: "asc" }, include: { movements: { take: 15, orderBy: { createdAt: "desc" } } } }));
}));
app.post("/products", auth, asyncRoute(async (req, res) => {
  const data = productSchema.parse(req.body);
  const product = await prisma.product.create({ data: { ...data, sku: data.sku?.trim() || null, packageSize: data.packageSize == null ? null : new Prisma.Decimal(data.packageSize), quantity: new Prisma.Decimal(data.quantity), minimum: new Prisma.Decimal(data.minimum), cost: new Prisma.Decimal(data.cost), price: new Prisma.Decimal(data.price) } });
  if (data.quantity > 0) await prisma.stockMovement.create({ data: { productId: product.id, type: StockMovementType.ENTRADA, quantity: new Prisma.Decimal(data.quantity), previousStock: new Prisma.Decimal(0), resultingStock: new Prisma.Decimal(data.quantity), reason: "Stock inicial" } });
  res.status(201).json(product);
}));
app.put("/products/:id", auth, asyncRoute(async (req, res) => {
  const id = param(req, "id"); const data = productSchema.parse(req.body); const current = await prisma.product.findUniqueOrThrow({ where: { id } }); const next = new Prisma.Decimal(data.quantity); const diff = next.minus(current.quantity);
  const product = await prisma.$transaction(async tx => {
    const updated = await tx.product.update({ where: { id }, data: { ...data, sku: data.sku?.trim() || null, packageSize: data.packageSize == null ? null : new Prisma.Decimal(data.packageSize), quantity: next, minimum: new Prisma.Decimal(data.minimum), cost: new Prisma.Decimal(data.cost), price: new Prisma.Decimal(data.price) } });
    if (!diff.isZero()) await tx.stockMovement.create({ data: { productId: id, type: StockMovementType.AJUSTE, quantity: diff, previousStock: current.quantity, resultingStock: next, reason: "Edición manual" } });
    return updated;
  });
  res.json(product);
}));
app.post("/products/:id/movements", auth, asyncRoute(async (req, res) => {
  const id = param(req, "id"); const data = movementSchema.parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const product = await tx.product.findUniqueOrThrow({ where: { id } });
    const raw = new Prisma.Decimal(data.quantity);
    const signed = [StockMovementType.SALIDA, StockMovementType.CONSUMO_CITA, StockMovementType.VENTA, StockMovementType.MERMA].includes(data.type) ? raw.abs().negated() : data.type === StockMovementType.ENTRADA ? raw.abs() : raw;
    const next = product.quantity.plus(signed); if (next.lessThan(0)) throw new Error("No hay suficiente stock.");
    const updated = await tx.product.update({ where: { id }, data: { quantity: next } });
    const movement = await tx.stockMovement.create({ data: { productId: id, appointmentId: data.appointmentId || null, type: data.type, quantity: signed, previousStock: product.quantity, resultingStock: next, reason: data.reason || null } });
    return { product: updated, movement };
  });
  res.status(201).json(result);
}));
app.delete("/products/:id", auth, asyncRoute(async (req, res) => { await prisma.product.update({ where: { id: param(req, "id") }, data: { active: false } }); res.status(204).end(); }));

// CITAS
app.get("/appointments", auth, asyncRoute(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 31 * 86400000);
  res.json(await prisma.appointment.findMany({ where: { startsAt: { gte: from, lt: to } }, include: { client: true, employee: true, services: true, products: { include: { product: true } } }, orderBy: { startsAt: "asc" } }));
}));
app.post("/appointments", auth, asyncRoute(async (req, res) => {
  const data = appointmentSchema.parse(req.body);
  const catalog = await prisma.service.findMany({ where: { id: { in: data.services.map(s => s.serviceId) }, active: true } });
  if (catalog.length !== data.services.length) throw new Error("Alguno de los servicios no existe o está desactivado.");
  const lines = data.services.map(item => { const service = catalog.find(s => s.id === item.serviceId)!; const finalPrice = Number(service.price) * (1 - item.discount / 100); return { serviceId: service.id, serviceName: service.name, durationMin: service.durationMin, unitPrice: service.price, discount: new Prisma.Decimal(item.discount), finalPrice: new Prisma.Decimal(finalPrice) }; });
  const totalMinutes = lines.reduce((sum, line) => sum + line.durationMin, 0); const startsAt = new Date(data.startsAt); const endsAt = new Date(startsAt.getTime() + totalMinutes * 60000); const total = lines.reduce((sum, line) => sum + Number(line.finalPrice), 0);
  const appointment = await prisma.appointment.create({ data: { clientId: data.clientId, employeeId: data.employeeId, startsAt, endsAt, status: data.status, notes: data.notes, paid: data.paid, total: new Prisma.Decimal(total), services: { create: lines }, products: { create: data.products.map(p => ({ productId: p.productId, quantity: new Prisma.Decimal(p.quantity) })) } }, include: { client: true, employee: true, services: true, products: { include: { product: true } } } });
  res.status(201).json(appointment);
}));
app.put("/appointments/:id", auth, asyncRoute(async (req, res) => {
  const id = param(req, "id"); const data = appointmentSchema.parse(req.body); const catalog = await prisma.service.findMany({ where: { id: { in: data.services.map(s => s.serviceId) } } });
  const lines = data.services.map(item => { const service = catalog.find(s => s.id === item.serviceId); if (!service) throw new Error("Servicio no encontrado."); const finalPrice = Number(service.price) * (1 - item.discount / 100); return { serviceId: service.id, serviceName: service.name, durationMin: service.durationMin, unitPrice: service.price, discount: new Prisma.Decimal(item.discount), finalPrice: new Prisma.Decimal(finalPrice) }; });
  const startsAt = new Date(data.startsAt); const endsAt = new Date(startsAt.getTime() + lines.reduce((sum, x) => sum + x.durationMin, 0) * 60000); const total = lines.reduce((sum, x) => sum + Number(x.finalPrice), 0);
  const appointment = await prisma.$transaction(async tx => {
    await tx.appointmentService.deleteMany({ where: { appointmentId: id } }); await tx.appointmentProduct.deleteMany({ where: { appointmentId: id } });
    return tx.appointment.update({ where: { id }, data: { clientId: data.clientId, employeeId: data.employeeId, startsAt, endsAt, status: data.status, notes: data.notes, paid: data.paid, total: new Prisma.Decimal(total), services: { create: lines }, products: { create: data.products.map(p => ({ productId: p.productId, quantity: new Prisma.Decimal(p.quantity) })) } }, include: { client: true, employee: true, services: true, products: { include: { product: true } } } });
  });
  res.json(appointment);
}));
app.post("/appointments/:id/finish", auth, asyncRoute(async (req, res) => {
  const id = param(req, "id");
  const result = await prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { products: true } });
    if (appointment.status === AppointmentStatus.FINALIZADA) return appointment;
    for (const usage of appointment.products) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: usage.productId } }); const next = product.quantity.minus(usage.quantity); if (next.lessThan(0)) throw new Error(`No hay suficiente stock de ${product.name}.`);
      await tx.product.update({ where: { id: product.id }, data: { quantity: next } });
      await tx.stockMovement.create({ data: { productId: product.id, appointmentId: id, type: StockMovementType.CONSUMO_CITA, quantity: usage.quantity.negated(), previousStock: product.quantity, resultingStock: next, reason: "Consumo al finalizar cita" } });
    }
    return tx.appointment.update({ where: { id }, data: { status: AppointmentStatus.FINALIZADA } });
  });
  res.json(result);
}));
app.delete("/appointments/:id", auth, asyncRoute(async (req, res) => { await prisma.appointment.delete({ where: { id: param(req, "id") } }); res.status(204).end(); }));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (error instanceof z.ZodError) { res.status(400).json({ message: "Revisa los datos introducidos.", errors: error.issues }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { res.status(409).json({ message: "Ya existe un registro con esos datos únicos." }); return; }
    if (error.code === "P2025") { res.status(404).json({ message: "Registro no encontrado." }); return; }
  }
  res.status(500).json({ message: error instanceof Error ? error.message : "Error interno del servidor." });
});

ensureAdmin().then(() => app.listen(port, "0.0.0.0", () => console.log(`Rachel Studio API escuchando en el puerto ${port}`))).catch(error => { console.error("No se pudo iniciar la aplicación:", error); process.exit(1); });
async function shutdown() { await prisma.$disconnect(); process.exit(0); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
