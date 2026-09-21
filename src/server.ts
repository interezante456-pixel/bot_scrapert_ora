/**
 * BES Scraper Engine — HTTP Server opcional (Express)
 * Permite que el backend NestJS llame al motor de scraping por HTTP.
 *
 * Uso:
 *   node dist/server.js          (puerto 3001 por defecto)
 *   HTTP_PORT=3002 node dist/server.js
 *
 * Endpoints:
 *   GET  /health          → { status: 'ok', version: '1.0.0', uptime: Xs }
 *   POST /sunat           → { ruc, usuarioSol, claveSol, descargarPdfs?, headless? }
 *   POST /sunafil         → { ruc, usuarioSol, claveSol, modulos?, headless? }
 */

import express, { Request, Response, NextFunction } from 'express';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

import { SunatRunner } from './sunat/sunat-runner';
import { SunafilRunner } from './sunafil/sunafil-runner';
import { Logger } from './shared/logger';
import { SunatRunInput, SunafilRunInput } from './shared/types';

const logger = new Logger('HTTPServer');
const app = express();
const PORT = parseInt(process.env.HTTP_PORT ?? '3001', 10);

// Jobs en progreso (jobId → estado)
const jobs = new Map<string, 'running' | 'done' | 'error'>();

app.use(express.json());

// ─── Logger de requests ───────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.log(`${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    activeJobs: jobs.size,
  });
});

// ─────────────────────────────────────────────
// POST /sunat
// Body: { ruc, usuarioSol, claveSol, descargarPdfs?, headless? }
// ─────────────────────────────────────────────
app.post('/sunat', async (req: Request, res: Response) => {
  const { ruc, usuarioSol, claveSol, descargarPdfs, headless } = req.body as SunatRunInput;

  if (!ruc || !usuarioSol || !claveSol) {
    res.status(400).json({ error: 'Faltan campos obligatorios: ruc, usuarioSol, claveSol' });
    return;
  }

  const jobId = `sunat-${ruc}-${Date.now()}`;
  jobs.set(jobId, 'running');
  logger.log(`Job iniciado: ${jobId}`);

  try {
    const runner = new SunatRunner();
    const result = await runner.run({
      ruc,
      usuarioSol,
      claveSol,
      descargarPdfs: descargarPdfs ?? true,
      headless: headless ?? false,
    });
    jobs.set(jobId, result.success ? 'done' : 'error');
    res.json({ jobId, ...result });
  } catch (err) {
    const error = err as Error;
    logger.error(`Error en job ${jobId}`, error);
    jobs.set(jobId, 'error');
    res.status(500).json({
      jobId,
      success: false,
      error: error.message,
    });
  }
});

// ─────────────────────────────────────────────
// POST /sunafil
// Body: { ruc, usuarioSol, claveSol, modulos?, headless? }
// ─────────────────────────────────────────────
app.post('/sunafil', async (req: Request, res: Response) => {
  const { ruc, usuarioSol, claveSol, modulos, headless } = req.body as SunafilRunInput;

  if (!ruc || !usuarioSol || !claveSol) {
    res.status(400).json({ error: 'Faltan campos obligatorios: ruc, usuarioSol, claveSol' });
    return;
  }

  const jobId = `sunafil-${ruc}-${Date.now()}`;
  jobs.set(jobId, 'running');
  logger.log(`Job iniciado: ${jobId}`);

  try {
    const runner = new SunafilRunner();
    const result = await runner.run({
      ruc,
      usuarioSol,
      claveSol,
      modulos,
      headless: headless ?? false,
    });
    jobs.set(jobId, result.success ? 'done' : 'error');
    res.json({ jobId, ...result });
  } catch (err) {
    const error = err as Error;
    logger.error(`Error en job ${jobId}`, error);
    jobs.set(jobId, 'error');
    res.status(500).json({
      jobId,
      success: false,
      error: error.message,
    });
  }
});

// ─────────────────────────────────────────────
// GET /status/:jobId
// ─────────────────────────────────────────────
app.get('/status/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const status = jobs.get(jobId);
  if (!status) {
    res.status(404).json({ error: `Job "${jobId}" no encontrado.` });
    return;
  }
  res.json({ jobId, status });
});

// ─────────────────────────────────────────────
// Arranque del servidor
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  logger.success(`Scraper Engine HTTP server escuchando en http://localhost:${PORT}`);
  logger.log(`Endpoints: GET /health | POST /sunat | POST /sunafil | GET /status/:jobId`);
});

export default app;
