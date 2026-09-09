import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { routes, routeStops } from '../../database/schema';

type NewRoute = typeof routes.$inferInsert;
type RouteUpdate = Partial<typeof routes.$inferInsert>;
type NewRouteStop = typeof routeStops.$inferInsert;
type RouteStopUpdate = Partial<typeof routeStops.$inferInsert>;

export const routeRepository = {
  findAll: () => db.select().from(routes).all(),
  findById: (id: string) => db.select().from(routes).where(eq(routes.id, id)).get(),
  findBySchoolId: (schoolId: string) => db.select().from(routes).where(eq(routes.schoolId, schoolId)).all(),
  findStopsByRouteId: (routeId: string) => db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).all(),
  findStopById: (id: string) => db.select().from(routeStops).where(eq(routeStops.id, id)).get(),
  /** Phase 15 — no live creation path existed before this (100% seed-only). */
  create: (input: Omit<NewRoute, 'id'>) => {
    const row: NewRoute = { id: crypto.randomUUID(), ...input };
    db.insert(routes).values(row).run();
    return row;
  },
  update: (id: string, changes: RouteUpdate) => db.update(routes).set({ ...changes, updatedAt: new Date() }).where(eq(routes.id, id)).run(),
  /** `orderSequence` is the caller's responsibility (server.ts routes compute "current max + 1") — never guessed here. */
  createStop: (input: Omit<NewRouteStop, 'id'>) => {
    const row: NewRouteStop = { id: crypto.randomUUID(), ...input };
    db.insert(routeStops).values(row).run();
    return row;
  },
  updateStop: (id: string, changes: RouteStopUpdate) => db.update(routeStops).set({ ...changes, updatedAt: new Date() }).where(eq(routeStops.id, id)).run(),
  deleteStop: (id: string) => db.delete(routeStops).where(eq(routeStops.id, id)).run(),
  /** Phase 15.5 — deletion only ever happens through FleetProvisioningService.deleteRoute, which deletes this route's own stops first — never called against a route a trip still references (the FK would reject it anyway). */
  deleteById: (id: string) => db.delete(routes).where(eq(routes.id, id)).run(),
};
