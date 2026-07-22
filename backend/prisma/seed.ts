import { PrismaClient, AppointmentStatus } from '@prisma/client';
const p=new PrismaClient();
const cents=(n:number)=>Math.round(n*100);
async function main(){
  await p.appointmentService.deleteMany(); await p.appointment.deleteMany(); await p.clientRequest.deleteMany(); await p.stockMovement.deleteMany(); await p.serviceProduct.deleteMany(); await p.product.deleteMany(); await p.service.deleteMany(); await p.client.deleteMany(); await p.employee.deleteMany();
  const [laura,marta,sara,nerea]=await Promise.all([
    p.employee.create({data:{name:'Laura',role:'Peluquería',color:'#ff4fa3'}}),p.employee.create({data:{name:'Marta',role:'Peluquería',color:'#ffaf68'}}),p.employee.create({data:{name:'Sara',role:'Estética',color:'#c57cff'}}),p.employee.create({data:{name:'Nerea',role:'Estética',color:'#8c7dff'}})
  ]);
  const clients=await Promise.all(['María López','Ana Pérez','Laura Gómez','Clara Vega','Patricia Gil','Lucía Fernández','Alba Jiménez'].map((name,i)=>p.client.create({data:{name,phone:`60000000${i}`,email:`cliente${i+1}@example.com`}})));
  const services=await Promise.all([
    ['Corte mujer','Peluquería',60,29,'#ffd1e6'],['Coloración','Peluquería',90,55,'#ffc1dc'],['Mechas balayage','Peluquería',120,85,'#ffb3d6'],['Limpieza facial','Estética',60,48,'#ead6ff'],['Manicura semipermanente','Estética',60,32,'#e3ccff'],['Extensiones de pestañas','Estética',90,60,'#dcc4ff']
  ].map(([name,category,duration,price,color])=>p.service.create({data:{name:name as string,category:category as string,durationMinutes:duration as number,priceCents:cents(price as number),color:color as string}})));
  const products=await Promise.all([
    ['Oxidante 20 vol.','OX20','Coloración',2,5,'uds.'],['Tinte 6.0','TIN60','Coloración',3,10,'uds.'],['Guantes nitrilo','GUA100','Consumibles',4,10,'cajas'],['Mascarilla hidratante','MAS01','Tratamiento',2,5,'uds.']
  ].map(([name,sku,category,stock,minStock,unit])=>p.product.create({data:{name:name as string,sku:sku as string,category:category as string,stock:stock as number,minStock:minStock as number,unit:unit as string}})));
  await p.serviceProduct.createMany({data:[{serviceId:services[1].id,productId:products[0].id,quantity:1},{serviceId:services[1].id,productId:products[1].id,quantity:1},{serviceId:services[1].id,productId:products[2].id,quantity:.02}]});
  const today=new Date(); today.setHours(0,0,0,0);
  const at=(h:number,m=0)=>new Date(today.getTime()+(h*60+m)*60000);
  const seeds=[[0,laura,services[0],9,0],[1,laura,services[1],11,0],[2,laura,services[2],14,0],[3,sara,services[3],9,30],[4,sara,services[4],11,30],[5,nerea,services[5],10,0],[6,nerea,services[4],12,0]] as const;
  for(const [ci,e,s,h,m] of seeds) await p.appointment.create({data:{clientId:clients[ci].id,employeeId:e.id,startsAt:at(h,m),endsAt:new Date(at(h,m).getTime()+s.durationMinutes*60000),status:ci===0?AppointmentStatus.CONFIRMED:AppointmentStatus.PENDING,services:{create:{serviceId:s.id,priceCents:s.priceCents}}}});
  await p.clientRequest.createMany({data:[{clientId:clients[1].id,title:'Mechas balayage',description:'Quiere valoración con fotografía'},{clientId:clients[4].id,title:'Tratamiento facial',description:'Piel sensible'},{clientId:clients[5].id,title:'Extensiones de pestañas'}]});
}
main().finally(()=>p.$disconnect());
