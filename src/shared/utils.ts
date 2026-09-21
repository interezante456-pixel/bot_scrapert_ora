/**
 * Utilidades compartidas del motor de scraping BES.
 * Portadas y adaptadas del backend NestJS sin dependencias de framework.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────
// STRING / ENCODING
// ─────────────────────────────────────────────

/**
 * Corrige texto que llegó como mojibake (UTF-8 leído como latin1).
 * Portado de SunatScraperService.cleanUtf8()
 */
export function cleanUtf8(text: string): string {
  if (!text) return '';
  let result = text.trim();
  try {
    if (result.includes('Ã') || result.includes('Â')) {
      const decoded = Buffer.from(result, 'latin1').toString('utf8');
      if (decoded && !/\uFFFD/.test(decoded)) {
        result = decoded.trim();
      }
    }
  } catch {
    // ignore
  }
  return result;
}

/**
 * Normaliza un texto para comparación (sin tildes, minúsculas, sin espacios extra).
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// ─────────────────────────────────────────────
// ASYNC HELPERS
// ─────────────────────────────────────────────

/**
 * Espera un número determinado de milisegundos.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reintenta una función async hasta N veces con delay entre intentos.
 * @param fn        Función a ejecutar
 * @param attempts  Número máximo de intentos (default: 3)
 * @param delayMs   Delay en ms entre intentos (default: 3000)
 * @param label     Etiqueta para el log de errores
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 3000,
  label = 'operación',
): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        console.warn(`[retry] Intento ${i}/${attempts} de "${label}" fallido. Reintentando en ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────
// FILE SYSTEM
// ─────────────────────────────────────────────

/**
 * Crea un directorio de forma recursiva si no existe.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Resuelve el directorio de salida y lo crea si no existe.
 * Usa la variable de entorno OUTPUT_DIR o el default './output'.
 */
export function resolveOutputDir(subDir = ''): string {
  const base = process.env.OUTPUT_DIR ?? path.join(process.cwd(), 'output');
  const dir = subDir ? path.join(base, subDir) : base;
  ensureDir(dir);
  return dir;
}

/**
 * Sanitiza un string para usarlo como nombre de archivo (quita caracteres inválidos).
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').substring(0, 200);
}

/**
 * Guarda un buffer como archivo y retorna la ruta absoluta.
 */
export function saveBuffer(buffer: Buffer, filePath: string): string {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  return path.resolve(filePath);
}

/**
 * Guarda un objeto JSON como archivo de texto.
 */
export function saveJson(data: unknown, filePath: string): string {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return path.resolve(filePath);
}

// ─────────────────────────────────────────────
// DATE PARSING
// ─────────────────────────────────────────────

/**
 * Convierte una cadena de fecha peruana (DD/MM/YYYY o DD/MM/YYYY HH:mm) a Date.
 * Retorna null si no es parseable.
 */
export function parsePeDate(text: string | undefined | null): Date | null {
  if (!text) return null;
  const match = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour = '0', min = '0'] = match;
  const d = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(min),
  );
  return isNaN(d.getTime()) ? null : d;
}
