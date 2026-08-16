import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { routes, routeStops } from '../../database/schema';

export const routeRepository = {
  findAll: () => db.select().from(routes).all(),
  findById: (id: string) => db.select().from(routes).where(eq(routes.id, id)).get(),
  findBySchoolId: (schoolId: string) => db.select().from(routes).where(eq(routes.schoolId, schoolId)).all(),
  findStopsByRouteId: (routeId: string) => db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).all(),
};
