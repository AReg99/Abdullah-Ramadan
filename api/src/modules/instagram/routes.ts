import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { guard } from "../../auth/jwt.js";
import { SETUP } from "../../auth/scopes.js";
import { discard, storeFile } from "../../lib/uploads.js";

/**
 * Bringing the catalogue in from the page it already lives on.
 *
 * This talks to Instagram's own Graph API with a token the owner supplies —
 * never by scraping, which breaks the moment Instagram changes a class name and
 * is against their terms besides. The token is used for the request and not
 * stored: a long-lived Instagram token is a key to the account, and this app has
 * no business holding one it does not need between two clicks.
 */

/**
 * Overridable only outside production, so the integration can be exercised
 * against a stand-in. In production this is Instagram and nothing else, however
 * the environment is set.
 */
const isProd = process.env.NODE_ENV === "production";
const GRAPH = (!isProd && process.env.INSTAGRAM_GRAPH_BASE) || "https://graph.instagram.com";
const EXTRA_CDN = (!isProd && process.env.INSTAGRAM_CDN_HOST) || "";

/**
 * The client tells the server which image to fetch, so the server must not be
 * willing to fetch just anything: that turns this endpoint into a way to make
 * the server open URLs on someone else's behalf, including ones inside the
 * private network it sits in. Instagram's own CDN only.
 */
const CDN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
export function assertInstagramUrl(raw: string, extraHost = EXTRA_CDN) {
  const u = new URL(raw);
  if (u.protocol !== "https:" && !(extraHost && u.hostname === extraHost)) {
    throw new Error("image_url_not_https");
  }
  if (!CDN.test(u.hostname) && !(extraHost && u.hostname === extraHost)) {
    throw new Error("image_url_not_instagram");
  }
  return u;
}

type Media = {
  id: string;
  caption: string | null;
  permalink: string | null;
  timestamp: string | null;
  imageUrl: string | null;
  mediaType: string;
};

async function graph(pathAndQuery: string, token: string) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}${pathAndQuery}${sep}access_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as any)?.error?.message ?? `instagram_http_${res.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as any;
}

export default async function instagramRoutes(app: FastifyInstance) {
  /** Look at the page without committing to anything. */
  app.post("/admin/instagram/media", { preHandler: guard(SETUP) }, async (req, reply) => {
    const { token, limit } = z.object({
      token: z.string().min(20),
      limit: z.number().int().min(1).max(50).default(24),
    }).parse(req.body);

    let page: any;
    try {
      page = await graph(
        `/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${limit}`,
        token,
      );
    } catch (e: any) {
      // A bad or expired token is the normal failure here, not a server fault.
      return reply.code(e.status === 400 || e.status === 401 ? 400 : 502)
        .send({ error: "instagram_failed", detail: String(e.message).slice(0, 300) });
    }

    const items: Media[] = [];
    for (const m of page.data ?? []) {
      let imageUrl: string | null = m.media_url ?? m.thumbnail_url ?? null;
      // A carousel post carries no image of its own; its first child does.
      if (m.media_type === "CAROUSEL_ALBUM") {
        try {
          const kids = await graph(`/${m.id}/children?fields=media_url,thumbnail_url`, token);
          imageUrl = kids.data?.[0]?.media_url ?? kids.data?.[0]?.thumbnail_url ?? null;
        } catch { imageUrl = null; }
      }
      items.push({
        id: String(m.id),
        caption: m.caption ?? null,
        permalink: m.permalink ?? null,
        timestamp: m.timestamp ?? null,
        mediaType: m.media_type ?? "IMAGE",
        imageUrl,
      });
    }
    // Anything with no still image cannot become a product photo.
    return items.filter((i) => i.imageUrl);
  });

  /**
   * Turn chosen posts into products. Each one is created and its picture
   * downloaded server-side; a post whose image cannot be fetched is reported
   * rather than left as a product with no photo.
   */
  app.post("/admin/instagram/import", { preHandler: guard(SETUP) }, async (req, reply) => {
    const b = z.object({
      categoryId: z.string(),
      items: z.array(z.object({
        imageUrl: z.string().url(),
        nameAr: z.string().min(1),
        sku: z.string().min(1).optional(),
        basePrice: z.number().nonnegative().default(0),
        permalink: z.string().optional(),
      })).min(1).max(50),
    }).parse(req.body);

    if (!(await db.productCategory.findUnique({ where: { id: b.categoryId } }))) {
      return reply.code(400).send({ error: "unknown_category" });
    }

    const created: { id: string; sku: string; nameAr: string }[] = [];
    const failed: { nameAr: string; reason: string }[] = [];

    for (const item of b.items) {
      let stored: string | null = null;
      try {
        assertInstagramUrl(item.imageUrl);

        const sku = item.sku?.trim() || (await nextSku());
        if (await db.product.findUnique({ where: { sku } })) {
          failed.push({ nameAr: item.nameAr, reason: "sku_taken" });
          continue;
        }

        const res = await fetch(item.imageUrl, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`image_http_${res.status}`);
        const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!mime.startsWith("image/")) throw new Error("not_an_image");
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.byteLength) throw new Error("empty_image");
        if (buf.byteLength > 8 * 1024 * 1024) throw new Error("image_too_large");

        const saved = await storeFile(buf, mime, "products");
        stored = saved.rel;

        const product = await db.product.create({
          data: {
            sku, nameAr: item.nameAr, nameEn: item.nameAr,
            categoryId: b.categoryId, basePrice: String(item.basePrice),
            // Imported products land switched off: a price of zero must not be
            // sellable, and the owner has to look at each one first.
            isActive: false,
          },
        });
        await db.productPhoto.create({
          data: {
            productId: product.id, filename: "instagram.jpg", path: saved.rel,
            mime, bytes: buf.byteLength, sortOrder: 0, actorId: (req as any).user.id,
          },
        });
        created.push({ id: product.id, sku: product.sku, nameAr: product.nameAr });
      } catch (e: any) {
        if (stored) await discard(stored);
        failed.push({ nameAr: item.nameAr, reason: String(e.message).slice(0, 120) });
      }
    }
    return { created, failed };
  });
}

/** IG-0001, IG-0002 … so an import never has to invent codes by hand. */
async function nextSku() {
  const last = await db.product.findFirst({
    where: { sku: { startsWith: "IG-" } }, orderBy: { sku: "desc" }, select: { sku: true },
  });
  const n = last ? Number(last.sku.slice(3)) + 1 : 1;
  return `IG-${String(Number.isFinite(n) ? n : 1).padStart(4, "0")}`;
}
