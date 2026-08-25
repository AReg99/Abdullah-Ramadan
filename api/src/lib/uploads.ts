import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

/**
 * What the business actually hands over: pictures of furniture, and paperwork.
 * Anything outside this list is refused rather than stored — an upload box that
 * accepts every type is a way to put something executable on the server.
 */
const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
};

export const isAllowed = (mime: string) => mime in EXT;
export const allowedTypes = Object.keys(EXT);

export type Incoming = {
  buf: Buffer | null;
  filename: string;
  mime: string;
  fields: Record<string, string>;
};

/** Drain a multipart request into one file plus its text fields. */
export async function readUpload(req: FastifyRequest): Promise<Incoming> {
  let buf: Buffer | null = null;
  let filename = "file";
  let mime = "application/octet-stream";
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      buf = await part.toBuffer();
      filename = part.filename || filename;
      mime = part.mimetype || mime;
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { buf, filename, mime, fields };
}

export type Stored = { rel: string; abs: string };

/**
 * Write the bytes under a name we generate. The uploaded filename is
 * attacker-controlled text and is kept for display only — never for the path,
 * and never for the extension, which comes from the declared type.
 */
export async function storeFile(buf: Buffer, mime: string, subdir: string): Promise<Stored> {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(env.uploadDir, subdir, day);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}${EXT[mime] ?? ".bin"}`;
  const abs = path.join(dir, name);
  await writeFile(abs, buf);
  return { rel: path.posix.join(subdir, day, name), abs };
}

/** Best effort: a file nobody has a row for is litter, not an error. */
export const discard = (relOrAbs: string) =>
  unlink(path.isAbsolute(relOrAbs) ? relOrAbs : path.join(env.uploadDir, relOrAbs)).catch(() => {});
