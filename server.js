"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "site-data.json");
const UPLOAD_DIR = path.join(ROOT, "uploads", "destinations");
const PORT = Number(process.env.PORT || 4173);
const PASSCODE_HASH = process.env.SAFE_BEE_ADMIN_PASSCODE_HASH || "da586a8b597a75ba0c5066cabbcef437ecf4e76bbe38890c2992fa6101719ded";
const SESSION_SECRET = process.env.SAFE_BEE_SESSION_SECRET || "safe-bee-local-dev-session-secret-change-me";
const SESSION_COOKIE = "safeBeeAdminSession";
const MAX_JSON_BODY = 14 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, headers));
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, {"Content-Type": "application/json; charset=utf-8"});
}

function notFound(res) {
  sendJson(res, 404, {error: "Not found"});
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmac(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + hmac(encoded);
}

function verifySession(token) {
  if (!token || !token.includes(".")) return false;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig || hmac(encoded) !== sig) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.exp && Date.now() < payload.exp;
  } catch (_) {
    return false;
  }
}

function parseCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((memo, part) => {
    const index = part.indexOf("=");
    if (index > -1) memo[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return memo;
  }, {});
}

function isAdmin(req) {
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, {error: "Admin authentication required"});
  return false;
}

function readBody(req, limit = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function readData() {
  const raw = await fsp.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeData(data) {
  data.version = data.version || 1;
  data.updatedAt = new Date().toISOString();
  const tmp = DATA_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, DATA_FILE);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  return [];
}

function normalizeImages(images) {
  return Array.isArray(images) ? images.map((image, index) => ({
    id: String(image.id || crypto.randomUUID()),
    src: String(image.src || "").trim(),
    caption: String(image.caption || "").trim(),
    alt: String(image.alt || "").trim(),
    isCover: !!image.isCover,
    order: Number(image.order || index + 1)
  })).filter(image => image.src) : [];
}

function normalizeDays(days) {
  return Array.isArray(days) ? days.map((day, index) => ({
    id: String(day.id || crypto.randomUUID()),
    dayNumber: Number(day.dayNumber || index + 1),
    title: String(day.title || "").trim(),
    description: String(day.description || "").trim(),
    activities: normalizeList(day.activities),
    places: normalizeList(day.places),
    meals: String(day.meals || "").trim(),
    accommodation: String(day.accommodation || "").trim(),
    notes: String(day.notes || "").trim(),
    order: Number(day.order || index + 1)
  })) : [];
}

function slugify(value) {
  return String(value || "destination").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "destination";
}

function normalizeData(input) {
  const now = new Date().toISOString();
  if (!input || !Array.isArray(input.destinations)) throw new Error("Destinations must be an array");
  const destinations = input.destinations.map((destination, destIndex) => {
    const name = String(destination.name || "").trim();
    if (!name) throw new Error("Every destination needs a name");
    const id = String(destination.id || slugify(name) + "-" + crypto.randomUUID().slice(0, 8));
    const gallery = normalizeImages(destination.gallery);
    if (gallery.length && !gallery.some(image => image.isCover)) gallery[0].isCover = true;
    const plans = Array.isArray(destination.plans) ? destination.plans.map((plan, planIndex) => {
      const planName = String(plan.name || "").trim();
      if (!planName) throw new Error("Every tour plan needs a name");
      const planGallery = normalizeImages(plan.gallery);
      if (planGallery.length && !planGallery.some(image => image.isCover)) planGallery[0].isCover = true;
      return {
        id: String(plan.id || slugify(planName) + "-" + crypto.randomUUID().slice(0, 8)),
        name: planName,
        shortDescription: String(plan.shortDescription || "").trim(),
        duration: String(plan.duration || "").trim(),
        days: Math.max(0, Number(plan.days || 0)),
        nights: Math.max(0, Number(plan.nights || 0)),
        startingPrice: String(plan.startingPrice || "").trim(),
        currency: String(plan.currency || "USD").trim().slice(0, 8),
        priceLabel: String(plan.priceLabel || "Contact us").trim(),
        status: ["draft", "published", "unpublished"].includes(plan.status) ? plan.status : "draft",
        order: Number(plan.order || planIndex + 1),
        createdAt: plan.createdAt || now,
        updatedAt: now,
        routeStops: normalizeList(plan.routeStops),
        gallery: planGallery,
        itineraryDays: normalizeDays(plan.itineraryDays),
        highlights: normalizeList(plan.highlights),
        included: normalizeList(plan.included),
        excluded: normalizeList(plan.excluded),
        importantInfo: normalizeList(plan.importantInfo),
        thingsToBring: normalizeList(plan.thingsToBring),
        terms: normalizeList(plan.terms),
        pickupInfo: String(plan.pickupInfo || "").trim(),
        accommodationDetails: String(plan.accommodationDetails || "").trim(),
        transportationDetails: String(plan.transportationDetails || "").trim()
      };
    }) : [];
    return {
      id,
      name,
      shortTitle: String(destination.shortTitle || "").trim(),
      slug: slugify(destination.slug || name),
      shortDescription: String(destination.shortDescription || "").trim(),
      fullDescription: String(destination.fullDescription || "").trim(),
      region: String(destination.region || "").trim(),
      featured: !!destination.featured,
      status: ["draft", "published", "unpublished"].includes(destination.status) ? destination.status : "draft",
      order: Number(destination.order || destIndex + 1),
      archivedAt: destination.archivedAt || null,
      createdAt: destination.createdAt || now,
      updatedAt: now,
      location: {
        name: String(destination.location && destination.location.name || "").trim(),
        address: String(destination.location && destination.location.address || "").trim(),
        latitude: destination.location && destination.location.latitude !== "" ? Number(destination.location.latitude) : "",
        longitude: destination.location && destination.location.longitude !== "" ? Number(destination.location.longitude) : "",
        googleMapsUrl: String(destination.location && destination.location.googleMapsUrl || "").trim(),
        googleMapsEmbedUrl: String(destination.location && destination.location.googleMapsEmbedUrl || "").trim()
      },
      seo: {
        title: String(destination.seo && destination.seo.title || "").trim(),
        description: String(destination.seo && destination.seo.description || "").trim()
      },
      gallery,
      plans
    };
  });
  return {version: Number(input.version || 1), updatedAt: now, destinations};
}

function publicData(data) {
  const clone = JSON.parse(JSON.stringify(data));
  clone.destinations = (clone.destinations || [])
    .filter(destination => destination.status === "published" && !destination.archivedAt)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map(destination => {
      destination.plans = (destination.plans || [])
        .filter(plan => plan.status === "published")
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      return destination;
    })
    .filter(destination => destination.plans.length || destination.gallery.length);
  return clone;
}

function imageType(buffer, mime) {
  if (mime === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8) return ".jpg";
  if (mime === "image/png" && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (mime === "image/webp" && buffer.slice(0, 4).toString() === "RIFF" && buffer.slice(8, 12).toString() === "WEBP") return ".webp";
  return "";
}

function safeName(filename) {
  return String(filename || "image").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "image";
}

async function handleUpload(req, res) {
  const body = await readJsonBody(req);
  const match = String(body.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return sendJson(res, 400, {error: "Upload must be a JPG, PNG or WebP data URL"});
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) return sendJson(res, 400, {error: "Image must be smaller than 8 MB"});
  const ext = imageType(buffer, mime);
  if (!ext) return sendJson(res, 400, {error: "Uploaded file content does not match a supported image type"});
  await fsp.mkdir(UPLOAD_DIR, {recursive: true});
  const filename = Date.now() + "-" + safeName(body.filename) + ext;
  await fsp.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  sendJson(res, 201, {url: "/uploads/destinations/" + filename, filename});
}

function proxyGeocode(req, res, url) {
  const q = String(url.searchParams.get("q") || "").trim();
  if (!q) return sendJson(res, 400, {error: "Search query is required"});
  const target = "https://photon.komoot.io/api/?limit=5&q=" + encodeURIComponent(q);
  https.get(target, upstream => {
    let raw = "";
    upstream.setEncoding("utf8");
    upstream.on("data", chunk => raw += chunk);
    upstream.on("end", () => {
      try {
        const data = JSON.parse(raw);
        const results = (data.features || []).map(feature => ({
          name: feature.properties && (feature.properties.name || feature.properties.city || feature.properties.country) || q,
          address: [feature.properties && feature.properties.name, feature.properties && feature.properties.city, feature.properties && feature.properties.country].filter(Boolean).join(", "),
          latitude: feature.geometry.coordinates[1],
          longitude: feature.geometry.coordinates[0]
        }));
        sendJson(res, 200, {results});
      } catch (_) {
        sendJson(res, 502, {error: "Location search is unavailable"});
      }
    });
  }).on("error", () => sendJson(res, 502, {error: "Location search is unavailable"}));
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, {ok: true});
    if (req.method === "GET" && url.pathname === "/api/public-data") return sendJson(res, 200, publicData(await readData()));
    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      const body = await readJsonBody(req);
      if (sha256(body.passcode || "") !== PASSCODE_HASH) return sendJson(res, 401, {error: "Passcode not accepted"});
      const token = signSession({role: "admin", exp: Date.now() + 1000 * 60 * 60 * 8});
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      return sendJson(res, 200, {ok: true});
    }
    if (req.method === "POST" && url.pathname === "/api/admin/logout") {
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      return sendJson(res, 200, {ok: true});
    }
    if (url.pathname === "/api/admin/session") {
      return isAdmin(req) ? sendJson(res, 200, {ok: true}) : sendJson(res, 401, {error: "Admin authentication required"});
    }
    if (url.pathname === "/api/admin/geocode") {
      if (!requireAdmin(req, res)) return;
      return proxyGeocode(req, res, url);
    }
    if (url.pathname === "/api/admin/data") {
      if (!requireAdmin(req, res)) return;
      if (req.method === "GET") return sendJson(res, 200, await readData());
      if (req.method === "PUT") {
        const data = normalizeData(await readJsonBody(req));
        await writeData(data);
        return sendJson(res, 200, data);
      }
    }
    if (req.method === "POST" && url.pathname === "/api/admin/upload") {
      if (!requireAdmin(req, res)) return;
      return handleUpload(req, res);
    }
    notFound(res);
  } catch (err) {
    const status = /JSON|name|array|required|large|Destinations|tour plan/i.test(err.message || "") ? 400 : 500;
    sendJson(res, status, {error: err.message || "Server error"});
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  let target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) return notFound(res);
  try {
    const stat = await fsp.stat(target).catch(() => null);
    if (stat && stat.isDirectory()) target = path.join(target, "index.html");
    const file = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const isAsset = /\.(?:css|js|png|jpe?g|webp|svg|ico)$/i.test(target);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": isAsset ? "public, max-age=3600" : "no-store"
    });
    res.end(file);
  } catch (_) {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Safe Bee Tours server running at http://127.0.0.1:${PORT}/`);
});
