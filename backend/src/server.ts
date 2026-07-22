import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { PrismaClient, AppointmentStatus, RequestStatus, StockMovementType } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3001);
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(x => x.trim());

app.use(helmet());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/dashboard', wrap(async (_req, res) => {
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+1);
  const [appointments, requests, products, employees] = await Promise.all([
    prisma.appointment.findMany({ where: { startsAt: { gte: start, lt: end } }, include: { client: true, employee: true, services: { include: { service: true } } }, orderBy: { startsAt: 'asc' } }),
    prisma.clientRequest.findMany({ include: { client: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.product.findMany({ orderBy: { stock: 'asc' } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
  ]);
  const lowStock = products.filter(p => p.stock <= p.minStock);
  res.json({ appointments, requests, lowStock, employees, stats: { appointmentsToday: appointments.length, pendingRequests: requests.filter(r => ['NEW','REVIEWING'].includes(r.status)).length, lowStock: lowStock.length, revenueTodayCents: appointments.filter(a => a.status === 'COMPLETED').flatMap(a => a.services).reduce((s,x)=>s+x.priceCents,0) } });
}));

app.get('/api/clients', wrap(async (_req,res)=>res.json(await prisma.client.findMany({ orderBy:{name:'asc'} }))));
app.post('/api/clients', wrap(async (req,res)=>{
  const data=z.object({name:z.string().min(2),phone:z.string().optional(),email:z.string().email().optional().or(z.literal('')),notes:z.string().optional()}).parse(req.body);
  res.status(201).json(await prisma.client.create({data:{...data,email:data.email||null}}));
}));
app.get('/api/services', wrap(async (_req,res)=>res.json(await prisma.service.findMany({where:{active:true},orderBy:[{category:'asc'},{name:'asc'}]}))));
app.get('/api/employees', wrap(async (_req,res)=>res.json(await prisma.employee.findMany({where:{active:true},orderBy:{name:'asc'}}))));
app.get('/api/products', wrap(async (_req,res)=>res.json(await prisma.product.findMany({orderBy:{name:'asc'}}))));
app.get('/api/requests', wrap(async (_req,res)=>res.json(await prisma.clientRequest.findMany({include:{client:true},orderBy:{createdAt:'desc'}}))));

app.post('/api/appointments', wrap(async (req,res)=>{
  const data=z.object({clientId:z.string(),employeeId:z.string(),serviceIds:z.array(z.string()).min(1),startsAt:z.string().datetime(),notes:z.string().optional()}).parse(req.body);
  const services=await prisma.service.findMany({where:{id:{in:data.serviceIds}}});
  const totalMinutes=services.reduce((s,x)=>s+x.durationMinutes,0);
  const start=new Date(data.startsAt); const end=new Date(start.getTime()+totalMinutes*60000);
  const conflict=await prisma.appointment.findFirst({where:{employeeId:data.employeeId,status:{notIn:['CANCELLED','NO_SHOW']},startsAt:{lt:end},endsAt:{gt:start}}});
  if(conflict) return res.status(409).json({message:'Ese empleado ya tiene una cita en ese horario.'});
  const appointment=await prisma.appointment.create({data:{clientId:data.clientId,employeeId:data.employeeId,startsAt:start,endsAt:end,notes:data.notes,services:{create:services.map(s=>({serviceId:s.id,priceCents:s.priceCents}))}},include:{client:true,employee:true,services:{include:{service:true}}}});
  res.status(201).json(appointment);
}));

app.patch('/api/appointments/:id/status', wrap(async (req,res)=>{
  const status=z.nativeEnum(AppointmentStatus).parse(req.body.status);
  const id=req.params.id;
  if(status==='COMPLETED'){
    const appointment=await prisma.appointment.findUniqueOrThrow({where:{id},include:{services:{include:{service:{include:{serviceProducts:true}}}}}});
    await prisma.$transaction(async tx=>{
      for(const link of appointment.services){ for(const usage of link.service.serviceProducts){
        await tx.product.update({where:{id:usage.productId},data:{stock:{decrement:usage.quantity}}});
        await tx.stockMovement.create({data:{productId:usage.productId,type:StockMovementType.SERVICE,quantity:-usage.quantity,note:`Consumo cita ${id}`}});
      }}
      await tx.appointment.update({where:{id},data:{status}});
    });
  } else await prisma.appointment.update({where:{id},data:{status}});
  res.json({ok:true});
}));

app.post('/api/requests', wrap(async (req,res)=>{
  const data=z.object({clientId:z.string(),title:z.string().min(2),description:z.string().optional(),preferredDate:z.string().datetime().optional()}).parse(req.body);
  res.status(201).json(await prisma.clientRequest.create({data:{...data,preferredDate:data.preferredDate?new Date(data.preferredDate):null},include:{client:true}}));
}));
app.patch('/api/requests/:id/status', wrap(async (req,res)=>{
  const status=z.nativeEnum(RequestStatus).parse(req.body.status);
  res.json(await prisma.clientRequest.update({where:{id:req.params.id},data:{status},include:{client:true}}));
}));
app.post('/api/products/:id/movements', wrap(async (req,res)=>{
  const data=z.object({quantity:z.number().refine(n=>n!==0),type:z.nativeEnum(StockMovementType),note:z.string().optional()}).parse(req.body);
  const result=await prisma.$transaction(async tx=>{ const p=await tx.product.update({where:{id:req.params.id},data:{stock:{increment:data.quantity}}}); await tx.stockMovement.create({data:{productId:p.id,...data}}); return p; });
  res.json(result);
}));

app.use((err:any,_req:any,res:any,_next:any)=>{ console.error(err); if(err instanceof z.ZodError) return res.status(400).json({message:'Datos no válidos',issues:err.issues}); res.status(500).json({message:'Error interno del servidor'}); });
app.listen(port,'0.0.0.0',()=>console.log(`Bella API en puerto ${port}`));
process.on('SIGTERM',async()=>{await prisma.$disconnect();process.exit(0)});
