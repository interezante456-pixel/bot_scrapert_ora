/**
 * BES Scraper Engine — CLI Entry Point
 * Uso:
 *   node dist/main.js sunat   --ruc 20123456789 --usuario MOLLO --clave miClave
 *   node dist/main.js sunafil --ruc 20123456789 --usuario MOLLO --clave miClave
 *   node dist/main.js sunat   --ruc 20123456789 --usuario MOLLO --clave miClave --headless
 *   node dist/main.js sunafil --ruc 20123456789 --usuario MOLLO --clave miClave --no-pdfs
 *
 * Salida: JSON estructurado por stdout (capturado por el backend con child_process.spawn).
 */

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Cargar variables de entorno desde .env (si existe)
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { SunatRunner } from './sunat/sunat-runner';
import { SunafilRunner } from './sunafil/sunafil-runner';
import { Logger } from './shared/logger';
import { SunatRunInput, SunafilRunInput, ModuloSunafil } from './shared/types';

const logger = new Logger('CLI');

const program = new Command();

program
  .name('bes-scraper')
  .description('Motor de scraping independiente para SUNAT y SUNAFIL — BES')
  .version('1.0.0');

// ─────────────────────────────────────────────
// Comando: sunat
// ─────────────────────────────────────────────
program
  .command('sunat')
  .description('Extrae notificaciones y PDFs del Buzón Electrónico de SUNAT')
  .requiredOption(
    '--ruc <ruc>',
    'RUC de la empresa',
    process.env.SUNAT_RUC,
  )
  .requiredOption(
    '--usuario <usuario>',
    'Usuario SOL',
    process.env.SUNAT_USUARIO,
  )
  .requiredOption(
    '--clave <clave>',
    'Clave SOL',
    process.env.SUNAT_CLAVE,
  )
  .option('--headless', 'Ejecutar en modo headless (navegador oculto)', false)
  .option('--no-pdfs', 'No descargar PDFs, solo listar notificaciones', false)
  .option('--output-dir <dir>', 'Directorio de salida para PDFs', process.env.OUTPUT_DIR)
  .action(async (opts) => {
    if (!opts.ruc || !opts.usuario || !opts.clave) {
      logger.error('Faltan credenciales. Usa --ruc, --usuario y --clave (o variables de entorno SUNAT_RUC, SUNAT_USUARIO, SUNAT_CLAVE).');
      process.exit(1);
    }

    if (opts.outputDir) {
      process.env.OUTPUT_DIR = opts.outputDir;
    }

    const input: SunatRunInput = {
      ruc: opts.ruc,
      usuarioSol: opts.usuario,
      claveSol: opts.clave,
      headless: opts.headless,
      descargarPdfs: !opts.noPdfs,
    };

    logger.log(`Iniciando scraper SUNAT para RUC ${input.ruc} (headless: ${input.headless}, PDFs: ${input.descargarPdfs})`);

    try {
      const runner = new SunatRunner();
      const result = await runner.run(input);

      // Salida JSON estructurada por stdout — capturada por el backend
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      const error = err as Error;
      logger.error('Error fatal en el scraper SUNAT', error);
      process.stdout.write(
        JSON.stringify({
          success: false,
          ruc: opts.ruc,
          totalExtraidas: 0,
          notificaciones: [],
          pdfsPaths: [],
          error: error.message,
        }) + '\n',
      );
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Comando: sunafil
// ─────────────────────────────────────────────
program
  .command('sunafil')
  .description('Extrae notificaciones de la Casilla Electrónica SUNAFIL')
  .requiredOption(
    '--ruc <ruc>',
    'RUC de la empresa',
    process.env.SUNAFIL_RUC ?? process.env.SUNAT_RUC,
  )
  .requiredOption(
    '--usuario <usuario>',
    'Usuario SOL',
    process.env.SUNAFIL_USUARIO ?? process.env.SUNAT_USUARIO,
  )
  .requiredOption(
    '--clave <clave>',
    'Clave SOL',
    process.env.SUNAFIL_CLAVE ?? process.env.SUNAT_CLAVE,
  )
  .option('--headless', 'Ejecutar en modo headless (navegador oculto)', false)
  .option(
    '--modulos <modulos>',
    'Módulos a extraer separados por coma (FISCALIZACION,COBRANZA,ACCIONES_PREVIAS,ALERTAS_FORMALIZACION,ALERTAS_SST)',
  )
  .action(async (opts) => {
    if (!opts.ruc || !opts.usuario || !opts.clave) {
      logger.error('Faltan credenciales. Usa --ruc, --usuario y --clave (o variables de entorno).');
      process.exit(1);
    }

    let modulos: ModuloSunafil[] | undefined;
    if (opts.modulos) {
      modulos = opts.modulos
        .split(',')
        .map((m: string) => m.trim().toUpperCase() as ModuloSunafil);
    }

    const input: SunafilRunInput = {
      ruc: opts.ruc,
      usuarioSol: opts.usuario,
      claveSol: opts.clave,
      headless: opts.headless,
      modulos,
    };

    logger.log(`Iniciando scraper SUNAFIL para RUC ${input.ruc} (headless: ${input.headless})`);

    try {
      const runner = new SunafilRunner();
      const result = await runner.run(input);

      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      const error = err as Error;
      logger.error('Error fatal en el scraper SUNAFIL', error);
      process.stdout.write(
        JSON.stringify({
          success: false,
          ruc: opts.ruc,
          totalExtraidas: 0,
          porModulo: {
            fiscalizacion: 0,
            cobranza: 0,
            accionesPrevias: 0,
            formalizacion: 0,
            sst: 0,
          },
          notificaciones: [],
          error: error.message,
        }) + '\n',
      );
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Arranque
// ─────────────────────────────────────────────
program.parse(process.argv);
