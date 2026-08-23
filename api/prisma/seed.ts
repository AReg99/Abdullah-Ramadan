import { PrismaClient, RoleKey, PhotoRule } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();

const ROLES: [RoleKey, string, string][] = [
  ["OWNER", "المالك", "Owner"],
  ["FACTORY_MANAGER", "مدير المصنع", "Factory manager"],
  ["SUPERVISOR", "مشرف", "Supervisor"],
  ["WORKER", "عامل", "Worker"],
  ["QC", "مفتش الجودة", "QC inspector"],
  ["STOREKEEPER", "أمين المخزن", "Storekeeper"],
  ["SHOWROOM_MANAGER", "مدير المعرض", "Showroom manager"],
  ["SALES_REP", "مندوب مبيعات", "Sales representative"],
  ["DRIVER", "سائق", "Driver"],
  ["ACCOUNTANT", "محاسب", "Accountant"],
];

// Stage key, ar, en, station code, std minutes, customer-visible, photo before, photo after.
// Gates follow docs/03-order-lifecycle.md: on where the evidence is worth the seconds.
const ROUTE: [string, string, string, string, number, boolean, PhotoRule, PhotoRule][] = [
  ["CUTTING",    "التقطيع",        "Cutting",     "CUT",  40, false, "OFF",      "OPTIONAL"],
  ["ASSEMBLY",   "التجميع",        "Assembly",    "ASM",  45, true,  "REQUIRED", "REQUIRED"],
  ["SANDING",    "التنعيم",        "Sanding",     "SND",  30, false, "OPTIONAL", "REQUIRED"],
  ["FINISHING",  "التشطيب",        "Finishing",   "FIN",  60, true,  "REQUIRED", "REQUIRED"],
  ["CURING",     "التجفيف",        "Curing",      "CUR",  90, false, "OFF",      "OFF"],
  ["UPHOLSTERY", "التنجيد",        "Upholstery",  "UPH",  75, false, "REQUIRED", "REQUIRED"],
  ["QC",         "فحص الجودة",     "Final QC",    "QCS",  20, true,  "OFF",      "REQUIRED"],
  ["PACKING",    "التغليف",        "Packing",     "PCK",  15, true,  "REQUIRED", "OFF"],
];

async function main() {
  console.log("seeding…");
  // Order matters: children before parents.
  await db.trackingEvent.deleteMany();
  await db.stagePhoto.deleteMany();
  await db.unitLabel.deleteMany();
  await db.workOrderStage.deleteMany();
  await db.workOrder.deleteMany();
  await db.orderLine.deleteMany();
  await db.order.deleteMany();
  await db.customer.deleteMany();
  await db.routingStage.deleteMany();
  await db.routing.deleteMany();
  await db.product.deleteMany();
  await db.productCategory.deleteMany();
  await db.otpCode.deleteMany();
  await db.user.deleteMany();
  await db.station.deleteMany();
  await db.location.deleteMany();
  await db.role.deleteMany();

  const roles = Object.fromEntries(
    await Promise.all(ROLES.map(async ([key, ar, en]) =>
      [key, await db.role.create({ data: { key, nameAr: ar, nameEn: en } })] as const))
  );

  const factory = await db.location.create({
    data: { type: "FACTORY", nameAr: "مصنع أورا — أكتوبر", nameEn: "Aura Factory — October",
            address: "October, 301 Central Axis" },
  });
  const showroom = await db.location.create({
    data: { type: "SHOWROOM", nameAr: "معرض أورا", nameEn: "Aura Showroom",
            address: "In front of Mecca Center" },
  });

  const stations = Object.fromEntries(
    await Promise.all(ROUTE.map(async ([, ar, en, code]) =>
      [code, await db.station.create({
        data: { code, nameAr: ar, nameEn: en, locationId: factory.id, dailyCapacityMinutes: 480 },
      })] as const))
  );

  const pwd = bcrypt.hashSync("aura1234", 10);
  const owner = await db.user.create({
    data: { nameAr: "عبدالله رمضان", nameEn: "Abdullah Ramadan", phone: "+201000000001",
            email: "owner@aura.test", passwordHash: pwd, roleId: roles.OWNER.id, locale: "ar" },
  });
  await db.user.create({
    data: { nameAr: "مدير المصنع", nameEn: "Factory Manager", phone: "+201000000002",
            email: "factory@aura.test", passwordHash: pwd, roleId: roles.FACTORY_MANAGER.id },
  });
  const workers = await Promise.all([
    db.user.create({ data: { nameAr: "محمد سيد", nameEn: "Mohamed Sayed", phone: "+201000000010",
      roleId: roles.WORKER.id, stationId: stations.ASM.id } }),
    db.user.create({ data: { nameAr: "كريم فؤاد", nameEn: "Kareem Fouad", phone: "+201000000011",
      roleId: roles.WORKER.id, stationId: stations.FIN.id } }),
    db.user.create({ data: { nameAr: "سيد جابر", nameEn: "Sayed Gaber", phone: "+201000000012",
      roleId: roles.WORKER.id, stationId: stations.UPH.id } }),
  ]);

  const cat = await db.productCategory.create({ data: { nameAr: "غرف نوم", nameEn: "Bedrooms" } });
  const catLiving = await db.productCategory.create({ data: { nameAr: "غرف معيشة", nameEn: "Living" } });

  const routing = await db.routing.create({
    data: { nameAr: "المسار القياسي", nameEn: "Standard routing", categoryId: cat.id, isDefault: true },
  });
  await Promise.all(ROUTE.map(([key, ar, en, code, mins, vis, pb, pa], i) =>
    db.routingStage.create({
      data: { routingId: routing.id, seq: i + 1, key, nameAr: ar, nameEn: en,
              stationId: stations[code].id, stdMinutes: mins, isCustomerVisible: vis,
              photoBefore: pb, photoAfter: pa },
    })));

  const products = await Promise.all([
    db.product.create({ data: { sku: "AUR-WRD-180", nameAr: "دولاب غرفة نوم", nameEn: "Bedroom wardrobe",
      basePrice: "38400", baseLeadDays: 18, categoryId: cat.id } }),
    db.product.create({ data: { sku: "AUR-SOF-3S", nameAr: "كنبة ٣ مقاعد", nameEn: "3-seat sofa",
      basePrice: "27500", baseLeadDays: 21, categoryId: catLiving.id, kind: "CUSTOMIZABLE" } }),
    db.product.create({ data: { sku: "AUR-TBL-200", nameAr: "ترابيزة سفرة", nameEn: "Dining table",
      basePrice: "21900", baseLeadDays: 14, categoryId: catLiving.id } }),
  ]);

  const customers = await Promise.all([
    db.customer.create({ data: { name: "محمود عبدالعزيز", phone: "+201200000001", locale: "ar" } }),
    db.customer.create({ data: { name: "سارة منير", phone: "+201200000002", locale: "ar" } }),
    db.customer.create({ data: { name: "Omar Khaled", phone: "+201200000003", locale: "en" } }),
  ]);

  const stages = await db.routingStage.findMany({ where: { routingId: routing.id }, orderBy: { seq: "asc" } });
  const day = 86400_000;

  for (let i = 0; i < 3; i++) {
    const product = products[i];
    const promised = new Date(Date.now() + (i === 0 ? -2 : i === 1 ? 2 : 20) * day);
    const order = await db.order.create({
      data: {
        code: `AUR-2026-${String(400 + i * 43).padStart(4, "0")}`,
        customerId: customers[i].id, showroomId: showroom.id,
        kind: product.kind === "CUSTOMIZABLE" ? "CUSTOM" : "STANDARD",
        status: "CONFIRMED", promisedDate: promised,
        total: product.basePrice, trackingToken: randomUUID(),
      },
    });
    const line = await db.orderLine.create({
      data: {
        orderId: order.id, productId: product.id, qty: 1, unitPrice: product.basePrice,
        lineKind: product.kind === "CUSTOMIZABLE" ? "CUSTOM" : "STANDARD",
        status: "QUEUED", promisedDate: promised,
        specNotes: i === 0 ? "زان أحمر · 180×90 سم · خامة رف B-12"
                 : i === 1 ? "قماش F-214 بيج · 210×95 سم · خامة رف C-04"
                           : "جوز · 200×100 سم · خامة رف A-21",
      },
    });
    const wo = await db.workOrder.create({
      data: {
        code: `WO-${String(1000 + i).padStart(4, "0")}`, orderLineId: line.id, productId: product.id,
        qty: 1, routingId: routing.id, status: "SCHEDULED", priority: 3 - i,
      },
    });
    await db.unitLabel.create({
      data: { workOrderId: wo.id, serial: `AURA-${wo.code}-1`, printedAt: new Date() },
    });
    await Promise.all(stages.map((st, k) =>
      db.workOrderStage.create({
        data: { workOrderId: wo.id, routingStageId: st.id, seq: st.seq,
                status: k === 0 ? "READY" : "PENDING" },
      })));
    await db.trackingEvent.create({
      data: { code: "ORDER_CONFIRMED", entityType: "order", entityId: order.id, orderId: order.id,
              actorId: owner.id, occurredAt: new Date(Date.now() - (3 - i) * day), isCustomerVisible: true },
    });
    await db.trackingEvent.create({
      data: { code: "WO_SCHEDULED", entityType: "work_order", entityId: wo.id, orderId: order.id,
              actorId: owner.id, occurredAt: new Date(Date.now() - (3 - i) * day + 3600_000) },
    });
  }

  // Wardrobe is mid-route so the floor view has something on the bench from the start.
  const wardrobeWo = await db.workOrder.findFirst({ where: { code: "WO-1000" } });
  if (wardrobeWo) {
    const [s1, s2] = await db.workOrderStage.findMany({
      where: { workOrderId: wardrobeWo.id }, orderBy: { seq: "asc" }, take: 2,
    });
    await db.workOrderStage.update({
      where: { id: s1.id },
      data: { status: "DONE", startedAt: new Date(Date.now() - 3 * 3600_000),
              finishedAt: new Date(Date.now() - 2 * 3600_000), actualMinutes: 52,
              assignedToId: workers[0].id },
    });
    await db.workOrderStage.update({ where: { id: s2.id }, data: { status: "READY" } });
  }

  console.log(`
seeded:
  owner        owner@aura.test / aura1234
  factory mgr  factory@aura.test / aura1234
  workers      +201000000010 (assembly) · +201000000011 (finishing) · +201000000012 (upholstery)
               OTP is 1234 in development
  3 orders, 3 work orders, ${stages.length}-stage routing with photo gates
`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
