import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Set the owner's sign-in details on a running server.
 *
 * The owner account is created once, when the database is first seeded. Editing
 * OWNER_EMAIL in .env.prod afterwards does nothing — the account already exists
 * — which is exactly the trap somebody falls into when they cannot sign in and
 * the obvious fix does not work.
 *
 * Usage:  node prisma/set-owner.mjs you@example.com "a password"
 */
const [email, password] = process.argv.slice(2);
const db = new PrismaClient();

if (!email || !password) {
  console.log("\nWho can sign in today:\n");
  for (const u of await db.user.findMany({ include: { role: true }, orderBy: { createdAt: "asc" } })) {
    if (!u.canLogin) continue;
    console.log(`  ${u.role.key.padEnd(18)} ${u.email ?? "—"}   ${u.phone ?? "—"}`);
  }
  console.log('\nTo change the owner:  node prisma/set-owner.mjs you@example.com "your password"\n');
  process.exit(0);
}
if (password.length < 6) {
  console.error("The password must be at least 6 characters.");
  process.exit(1);
}

const role = await db.role.findUnique({ where: { key: "OWNER" } });
const owner = await db.user.findFirst({ where: { roleId: role.id }, orderBy: { createdAt: "asc" } });
if (!owner) {
  console.error("No owner account exists. Something is wrong with the database.");
  process.exit(1);
}
// Somebody else holding this address would make the update fail on the unique
// index, which reads as a mystery rather than as the collision it is.
const clash = await db.user.findFirst({ where: { email, id: { not: owner.id } } });
if (clash) {
  console.error(`That email already belongs to another account (${clash.nameAr}).`);
  process.exit(1);
}

await db.user.update({
  where: { id: owner.id },
  data: { email, passwordHash: bcrypt.hashSync(password, 10), isActive: true, canLogin: true },
});
console.log(`\n  Done. ${owner.nameAr} can now sign in with:`);
console.log(`    email     ${email}`);
console.log(`    password  ${password}`);
console.log(`    or phone  ${owner.phone ?? "—"}\n`);
