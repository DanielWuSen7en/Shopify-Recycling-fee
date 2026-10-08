import { PrismaClient } from "@prisma/client";

let db;

if (process.env.NODE_ENV === "production") {
  db = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL },
    },
    log: ["error"],
  });
} else {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient({
      log: ["error", "warn"],
    });
  }

  db = global.prismaGlobal;
}

export default db;
