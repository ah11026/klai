import { randomUUID } from "node:crypto";
import path from "node:path";

export const MAX_GAME_BYTES = 15 * 1024 * 1024;
export const GAME_SYSTEMS = Object.freeze({
  nes: [".nes"],
  snes: [".sfc", ".smc"],
  n64: [".n64", ".z64", ".v64"],
  psx: [".bin", ".cue", ".iso", ".chd", ".pbp"]
});

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validateSystem(system) {
  if (!Object.hasOwn(GAME_SYSTEMS, system)) fail("نظام الألعاب غير مدعوم");
  return system;
}

function validateLicense(license, licenseUrl) {
  const name = typeof license === "string" ? license.trim().slice(0, 100) : "";
  if (!name) fail("اذكر ترخيص اللعبة قبل حفظها");

  let url;
  try {
    url = new URL(licenseUrl);
  } catch {
    fail("أضف رابطاً صالحاً يوضح ترخيص اللعبة");
  }
  if (url.protocol !== "https:") fail("يجب أن يكون رابط الترخيص آمناً (HTTPS)");
  return { license: name, licenseUrl: url.toString() };
}

function validateGameFile(system, filename, bytes) {
  validateSystem(system);
  const extension = path.posix.extname(filename).toLowerCase();
  if (!GAME_SYSTEMS[system].includes(extension)) {
    fail(`امتداد الملف ${extension || "غير معروف"} لا يناسب النظام المختار`);
  }
  if (!bytes?.length) fail("ملف اللعبة فارغ");
  if (bytes.length > MAX_GAME_BYTES) fail("الحد الأقصى لحجم الملف 15 ميغابايت", 413);
  return extension;
}

function validateSource({ repository, branch, filePath }) {
  if (typeof repository !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split("/").some(part => part === "." || part === "..")) {
    fail("صيغة المستودع يجب أن تكون owner/repository");
  }
  if (typeof branch !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(branch) || branch === "..") {
    fail("اسم الفرع غير صالح");
  }
  if (typeof filePath !== "string" || filePath.length > 240 ||
      filePath.startsWith("/") || filePath.includes("\\") ||
      filePath.split("/").some(part => !part || part === "." || part === "..")) {
    fail("مسار ملف المصدر غير صالح");
  }
  return {
    repository,
    branch,
    filePath,
    url: `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/${filePath.split("/").map(encodeURIComponent).join("/")}`
  };
}

function slugify(value) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export class GameLibrary {
  constructor({
    token = process.env.GAME_LIBRARY_GITHUB_TOKEN,
    repository = process.env.GAME_LIBRARY_REPOSITORY,
    branch = process.env.GAME_LIBRARY_BRANCH || "main",
    fetcher = fetch
  } = {}) {
    this.token = token;
    this.repository = repository;
    this.branch = branch;
    this.fetcher = fetcher;
  }

  get enabled() {
    return Boolean(this.token && this.repository && this.branch);
  }

  async request(endpoint, options = {}) {
    if (!this.enabled) fail("مكتبة الألعاب غير مهيأة على الخادم", 503);
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}/${endpoint}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Klai-Game-Library",
        ...options.headers
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = response.status === 409 || response.status === 422 ? 409 : 502;
      fail(data.message || "تعذر الاتصال بواجهة GitHub", status);
    }
    return data;
  }

  async readCatalog() {
    if (!this.enabled) fail("مكتبة الألعاب غير مهيأة على الخادم", 503);
    const endpoint = `contents/public/games/catalog.json?ref=${encodeURIComponent(this.branch)}`;
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}/${endpoint}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Klai-Game-Library"
      }
    });
    if (response.status === 404) return [];
    const data = await response.json().catch(() => ({}));
    if (!response.ok) fail(data.message || "تعذر قراءة مكتبة الألعاب من GitHub", 502);
    try {
      const catalog = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      return Array.isArray(catalog) ? catalog : fail("ملف فهرس الألعاب غير صالح", 502);
    } catch (error) {
      if (error.status) throw error;
      fail("تعذر تحليل فهرس الألعاب في GitHub", 502);
    }
  }

  async list() {
    if (!this.enabled) return { enabled: false, games: [] };
    return { enabled: true, games: await this.readCatalog() };
  }

  async downloadSource(source) {
    const response = await this.fetcher(source.url, {
      redirect: "error",
      headers: { "User-Agent": "Klai-Game-Library" },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) fail("تعذر تنزيل الملف من المستودع المحدد", 400);
    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength > MAX_GAME_BYTES) fail("حجم ملف المصدر يتجاوز 15 ميغابايت", 413);

    const chunks = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) fail("مصدر اللعبة لم يُرجع ملفاً قابلاً للقراءة");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GAME_BYTES) {
        await reader.cancel();
        fail("حجم ملف المصدر يتجاوز 15 ميغابايت", 413);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  }

  async save({ name, system, license, licenseUrl, filename, bytes, sourceRepository = "رفع مباشر" }) {
    const cleanName = typeof name === "string" ? name.trim().slice(0, 80) : "";
    if (!cleanName) fail("أدخل اسم اللعبة");
    const extension = validateGameFile(system, filename, bytes);
    const licenseInfo = validateLicense(license, licenseUrl);
    const catalog = await this.readCatalog();
    const fileName = `${slugify(cleanName) || system}-${randomUUID().slice(0, 8)}${extension}`;
    const filePath = `public/games/${system}/${fileName}`;
    const downloadUrl = `https://raw.githubusercontent.com/${this.repository}/${this.branch}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
    const game = {
      id: randomUUID(),
      name: cleanName,
      system,
      license: licenseInfo.license,
      licenseUrl: licenseInfo.licenseUrl,
      sourceRepository,
      path: filePath,
      downloadUrl,
      addedAt: new Date().toISOString()
    };
    const updatedCatalog = [...catalog, game];

    const reference = await this.request(`git/ref/heads/${encodeURIComponent(this.branch)}`);
    const headSha = reference.object.sha;
    const head = await this.request(`git/commits/${headSha}`);
    const [gameBlob, catalogBlob] = await Promise.all([
      this.request("git/blobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: Buffer.from(bytes).toString("base64"), encoding: "base64" })
      }),
      this.request("git/blobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(updatedCatalog, null, 2) + "\n", encoding: "utf-8" })
      })
    ]);
    const tree = await this.request("git/trees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: head.tree.sha,
        tree: [
          { path: filePath, mode: "100644", type: "blob", sha: gameBlob.sha },
          { path: "public/games/catalog.json", mode: "100644", type: "blob", sha: catalogBlob.sha }
        ]
      })
    });
    const commit = await this.request("git/commits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Add licensed ${system} game: ${cleanName}`,
        tree: tree.sha,
        parents: [headSha]
      })
    });
    await this.request(`git/refs/heads/${encodeURIComponent(this.branch)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commit.sha, force: false })
    });

    return game;
  }

  async importFromRepository(input) {
    const source = validateSource(input);
    const filename = path.posix.basename(source.filePath);
    const bytes = await this.downloadSource(source);
    return this.save({ ...input, filename, bytes, sourceRepository: source.repository });
  }

  async upload(input, bytes) {
    return this.save({ ...input, bytes, sourceRepository: "رفع مباشر" });
  }
}

export const gameLibraryValidation = Object.freeze({
  validateGameFile,
  validateLicense,
  validateSource
});