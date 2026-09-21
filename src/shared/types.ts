/**
 * Interfaces y tipos compartidos para el motor de scraping BES.
 * Fuente única de verdad para SUNAT y SUNAFIL.
 */

// ─────────────────────────────────────────────
// OPCIONES COMUNES
// ─────────────────────────────────────────────

export interface RunOptions {
  /** Mostrar el navegador en pantalla (false = visible, true = headless). Default: false */
  headless?: boolean;
  /** Directorio base donde guardar salidas. Default: ./output */
  outputDir?: string;
}

// ─────────────────────────────────────────────
// SUNAFIL — Tipos base
// ─────────────────────────────────────────────

export enum ModuloSunafil {
  FISCALIZACION = 'FISCALIZACION',
  COBRANZA = 'COBRANZA',
  ACCIONES_PREVIAS = 'ACCIONES_PREVIAS',
  ALERTAS_FORMALIZACION = 'ALERTAS_FORMALIZACION',
  ALERTAS_SST = 'ALERTAS_SST',
  ORIENTACION = 'ORIENTACION',
}

export interface BaseSunafilRecord {
  modulo: ModuloSunafil;
  /** Orden de Inspección, Expediente Sancionador, Registro, etc. */
  codigoReferencia: string;
  intendencia?: string;
  asunto: string;
  estado: string;
  fechaDeposito?: Date | null;
  fechaNotificacion?: Date | null;
  fechaAcuseRecibo?: Date | null;
  fechaLimite?: Date | null;
  plazoDias?: number | null;
  trabajadoresIncorporados?: number | null;
  tienePdf: boolean;
  /** Selector CSS para accionar la descarga del PDF */
  docActionSelector?: string;
  rutaArchivoPdf?: string | null;
  pdfDescargado?: boolean;
  metadataExtra?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// SUNAT
// ─────────────────────────────────────────────

export interface SunatRunInput extends RunOptions {
  ruc: string;
  usuarioSol: string;
  claveSol: string;
  /** Si se deben descargar los PDFs encontrados. Default: true */
  descargarPdfs?: boolean;
}

export interface SunatNotificacion {
  fileId: string;
  asunto: string;
  fechaMensaje: Date | null;
  /** URL para descargar el PDF (si está disponible en el buzón) */
  urlPdf?: string;
  /** Ruta local del PDF descargado */
  pdfPath?: string;
  /** Indica si el PDF fue descargado con éxito */
  pdfDescargado?: boolean;
  remitente?: string;
  estado?: string;
}

export interface SunatRunResult {
  success: boolean;
  ruc: string;
  totalExtraidas: number;
  notificaciones: SunatNotificacion[];
  /** Rutas absolutas de los PDFs descargados */
  pdfsPaths: string[];
  error?: string;
  /** Duración total en milisegundos */
  durationMs?: number;
}

// ─────────────────────────────────────────────
// SUNAFIL — Resultado del runner
// ─────────────────────────────────────────────

export interface SunafilRunInput extends RunOptions {
  ruc: string;
  usuarioSol: string;
  claveSol: string;
  /** Módulos a extraer. Si no se especifica, extrae todos. */
  modulos?: ModuloSunafil[];
}

export interface SunafilRunResult {
  success: boolean;
  ruc: string;
  totalExtraidas: number;
  porModulo: {
    fiscalizacion: number;
    cobranza: number;
    accionesPrevias: number;
    formalizacion: number;
    sst: number;
  };
  notificaciones: BaseSunafilRecord[];
  error?: string;
  /** Si se requiere acción manual (aceptar T&C, registrar contacto) */
  requiresManualAction?: boolean;
  requiresManualActionReason?: string;
  /** Duración total en milisegundos */
  durationMs?: number;
}

// ─────────────────────────────────────────────
// RESULTADO GENÉRICO
// ─────────────────────────────────────────────

export type ScraperResult = SunatRunResult | SunafilRunResult;
