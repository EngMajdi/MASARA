import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { telemetryDevices } from '../../database/schema';

type NewTelemetryDevice = typeof telemetryDevices.$inferInsert;
type TelemetryDeviceUpdate = Partial<typeof telemetryDevices.$inferInsert>;

export const telemetryDeviceRepository = {
  create: (entry: NewTelemetryDevice) => {
    const row = { id: crypto.randomUUID(), ...entry };
    db.insert(telemetryDevices).values(row).run();
    return row;
  },
  findAll: () => db.select().from(telemetryDevices).all(),
  findById: (id: string) => db.select().from(telemetryDevices).where(eq(telemetryDevices.id, id)).get(),
  findByBusId: (busId: string) => db.select().from(telemetryDevices).where(eq(telemetryDevices.busId, busId)).all(),
  update: (id: string, changes: TelemetryDeviceUpdate) =>
    db.update(telemetryDevices).set({ ...changes, updatedAt: new Date() }).where(eq(telemetryDevices.id, id)).run(),
};
