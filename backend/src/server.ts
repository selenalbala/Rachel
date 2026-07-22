import 'dotenv/config';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import {
  AppointmentStatus,
  PrismaClient,
  RequestStatus,
  StockMovementType
} from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3001);

const origins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:5173'
)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(helmet());

app.use(
  cors({
    origin: origins.includes('*') ? true : origins
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

const wrap = (
  handler: AsyncRouteHandler
): RequestHandler => {
  return (req, res, next) => {
    void Promise
      .resolve(handler(req, res, next))
      .catch(next);
  };
};

const obtenerParametro = (
  value: string | string[] | undefined
): string => {
  if (Array.isArray(value)) {
    if (!value[0]) {
      throw new Error(
        'Falta un parámetro obligatorio en la ruta.'
      );
    }

    return value[0];
  }

  if (!value) {
    throw new Error(
      'Falta un parámetro obligatorio en la ruta.'
    );
  }

  return value;
};

app.get(
  '/health',
  (_req: Request, res: Response) => {
    res.json({ ok: true });
  }
);

app.get(
  '/api/dashboard',
  wrap(async (_req, res) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [
      appointments,
      requests,
      products,
      employees
    ] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          startsAt: {
            gte: start,
            lt: end
          }
        },
        include: {
          client: true,
          employee: true,
          services: {
            include: {
              service: true
            }
          }
        },
        orderBy: {
          startsAt: 'asc'
        }
      }),

      prisma.clientRequest.findMany({
        include: {
          client: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 5
      }),

      prisma.product.findMany({
        orderBy: {
          stock: 'asc'
        }
      }),

      prisma.employee.findMany({
        where: {
          active: true
        },
        orderBy: {
          name: 'asc'
        }
      })
    ]);

    const lowStock = products.filter(
      product =>
        product.stock <= product.minStock
    );

    const pendingRequests = requests.filter(
      request =>
        request.status === RequestStatus.NEW ||
        request.status === RequestStatus.REVIEWING
    ).length;

    const revenueTodayCents = appointments
      .filter(
        appointment =>
          appointment.status ===
          AppointmentStatus.COMPLETED
      )
      .flatMap(
        appointment => appointment.services
      )
      .reduce(
        (total, service) =>
          total + service.priceCents,
        0
      );

    res.json({
      appointments,
      requests,
      lowStock,
      employees,
      stats: {
        appointmentsToday: appointments.length,
        pendingRequests,
        lowStock: lowStock.length,
        revenueTodayCents
      }
    });
  })
);

app.get(
  '/api/clients',
  wrap(async (_req, res) => {
    const clients =
      await prisma.client.findMany({
        orderBy: {
          name: 'asc'
        }
      });

    res.json(clients);
  })
);

app.post(
  '/api/clients',
  wrap(async (req, res) => {
    const data = z
      .object({
        name: z.string().min(2),
        phone: z.string().optional(),
        email: z
          .string()
          .email()
          .optional()
          .or(z.literal('')),
        notes: z.string().optional()
      })
      .parse(req.body);

    const client =
      await prisma.client.create({
        data: {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          notes: data.notes || null
        }
      });

    res.status(201).json(client);
  })
);

app.get(
  '/api/services',
  wrap(async (_req, res) => {
    const services =
      await prisma.service.findMany({
        where: {
          active: true
        },
        orderBy: [
          {
            category: 'asc'
          },
          {
            name: 'asc'
          }
        ]
      });

    res.json(services);
  })
);

app.get(
  '/api/employees',
  wrap(async (_req, res) => {
    const employees =
      await prisma.employee.findMany({
        where: {
          active: true
        },
        orderBy: {
          name: 'asc'
        }
      });

    res.json(employees);
  })
);

app.get(
  '/api/products',
  wrap(async (_req, res) => {
    const products =
      await prisma.product.findMany({
        orderBy: {
          name: 'asc'
        }
      });

    res.json(products);
  })
);

app.get(
  '/api/requests',
  wrap(async (_req, res) => {
    const requests =
      await prisma.clientRequest.findMany({
        include: {
          client: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

    res.json(requests);
  })
);

app.post(
  '/api/appointments',
  wrap(async (req, res) => {
    const data = z
      .object({
        clientId: z.string().min(1),
        employeeId: z.string().min(1),
        serviceIds: z
          .array(z.string())
          .min(1),
        startsAt: z.string().datetime(),
        notes: z.string().optional()
      })
      .parse(req.body);

    const services =
      await prisma.service.findMany({
        where: {
          id: {
            in: data.serviceIds
          },
          active: true
        }
      });

    if (
      services.length !==
      data.serviceIds.length
    ) {
      res.status(400).json({
        message:
          'Uno o varios servicios no existen.'
      });

      return;
    }

    const totalMinutes = services.reduce(
      (total, service) =>
        total + service.durationMinutes,
      0
    );

    const start = new Date(data.startsAt);

    const end = new Date(
      start.getTime() +
      totalMinutes * 60_000
    );

    const conflict =
      await prisma.appointment.findFirst({
        where: {
          employeeId: data.employeeId,
          status: {
            notIn: [
              AppointmentStatus.CANCELLED,
              AppointmentStatus.NO_SHOW
            ]
          },
          startsAt: {
            lt: end
          },
          endsAt: {
            gt: start
          }
        }
      });

    if (conflict) {
      res.status(409).json({
        message:
          'Ese empleado ya tiene una cita en ese horario.'
      });

      return;
    }

    const appointment =
      await prisma.appointment.create({
        data: {
          clientId: data.clientId,
          employeeId: data.employeeId,
          startsAt: start,
          endsAt: end,
          notes: data.notes || null,
          services: {
            create: services.map(
              service => ({
                serviceId: service.id,
                priceCents:
                  service.priceCents
              })
            )
          }
        },
        include: {
          client: true,
          employee: true,
          services: {
            include: {
              service: true
            }
          }
        }
      });

    res.status(201).json(appointment);
  })
);

app.patch(
  '/api/appointments/:id/status',
  wrap(async (req, res) => {
    const status = z
      .nativeEnum(AppointmentStatus)
      .parse(req.body.status);

    const id = obtenerParametro(
      req.params.id
    );

    if (
      status ===
      AppointmentStatus.COMPLETED
    ) {
      const appointmentServices =
        await prisma.appointmentService.findMany({
          where: {
            appointmentId: id
          },
          include: {
            service: {
              include: {
                serviceProducts: true
              }
            }
          }
        });

      await prisma.$transaction(
        async transaction => {
          for (
            const appointmentService of
            appointmentServices
          ) {
            for (
              const usage of
              appointmentService.service
                .serviceProducts
            ) {
              await transaction.product.update({
                where: {
                  id: usage.productId
                },
                data: {
                  stock: {
                    decrement:
                      usage.quantity
                  }
                }
              });

              await transaction
                .stockMovement.create({
                  data: {
                    productId:
                      usage.productId,
                    type:
                      StockMovementType.SERVICE,
                    quantity:
                      -usage.quantity,
                    note:
                      `Consumo cita ${id}`
                  }
                });
            }
          }

          await transaction
            .appointment.update({
              where: {
                id
              },
              data: {
                status
              }
            });
        }
      );
    } else {
      await prisma.appointment.update({
        where: {
          id
        },
        data: {
          status
        }
      });
    }

    res.json({
      ok: true
    });
  })
);

app.post(
  '/api/requests',
  wrap(async (req, res) => {
    const data = z
      .object({
        clientId: z.string().min(1),
        title: z.string().min(2),
        description: z
          .string()
          .optional(),
        preferredDate: z
          .string()
          .datetime()
          .optional()
      })
      .parse(req.body);

    const request =
      await prisma.clientRequest.create({
        data: {
          clientId: data.clientId,
          title: data.title,
          description:
            data.description || null,
          preferredDate:
            data.preferredDate
              ? new Date(data.preferredDate)
              : null
        },
        include: {
          client: true
        }
      });

    res.status(201).json(request);
  })
);

app.patch(
  '/api/requests/:id/status',
  wrap(async (req, res) => {
    const status = z
      .nativeEnum(RequestStatus)
      .parse(req.body.status);

    const id = obtenerParametro(
      req.params.id
    );

    const request =
      await prisma.clientRequest.update({
        where: {
          id
        },
        data: {
          status
        },
        include: {
          client: true
        }
      });

    res.json(request);
  })
);

app.post(
  '/api/products/:id/movements',
  wrap(async (req, res) => {
    const data = z
      .object({
        quantity: z
          .number()
          .refine(
            quantity => quantity !== 0,
            {
              message:
                'La cantidad no puede ser cero.'
            }
          ),
        type: z.nativeEnum(
          StockMovementType
        ),
        note: z.string().optional()
      })
      .parse(req.body);

    const productId = obtenerParametro(
      req.params.id
    );

    const result =
      await prisma.$transaction(
        async transaction => {
          const product =
            await transaction.product.update({
              where: {
                id: productId
              },
              data: {
                stock: {
                  increment: data.quantity
                }
              }
            });

          await transaction
            .stockMovement.create({
              data: {
                productId: product.id,
                quantity: data.quantity,
                type: data.type,
                note: data.note || null
              }
            });

          return product;
        }
      );

    res.json(result);
  })
);

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error(error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        message: 'Datos no válidos',
        issues: error.issues
      });

      return;
    }

    res.status(500).json({
      message:
        'Error interno del servidor'
    });
  }
);

app.listen(
  port,
  '0.0.0.0',
  () => {
    console.log(
      `Bella API en puerto ${port}`
    );
  }
);

process.on(
  'SIGTERM',
  async () => {
    await prisma.$disconnect();
    process.exit(0);
  }
);
