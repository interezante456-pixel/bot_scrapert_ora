/**
 * SunatRunner — Motor de scraping BES
 * Orquestador principal de la extracción SUNAT.
 * Ejecuta: login → buzón → extracción de notificaciones → descarga PDFs → resultado JSON.
 */

import { Browser } from 'puppeteer';
import { BrowserService } from '../browser/browser.service';
import { SunatLogin } from './sunat-login';
import { SunatBuzon } from './sunat-buzon';
import { SunatExtractor } from './sunat-extractor';
import { SunatRunInput, SunatRunResult } from '../shared/types';
import { Logger } from '../shared/logger';
import { resolveOutputDir } from '../shared/utils';
import * as path from 'path';

export class SunatRunner {
  private readonly logger = new Logger('SunatRunner');

  private readonly browserService = new BrowserService();
  private readonly loginService = new SunatLogin();
  private readonly buzonService = new SunatBuzon();
  private readonly extractor = new SunatExtractor();

  /**
   * Ejecuta la extracción completa del Buzón SUNAT para un RUC.
   */
  async run(input: SunatRunInput): Promise<SunatRunResult> {
    const startTime = Date.now();
    const { ruc, usuarioSol, claveSol, headless, descargarPdfs = true } = input;

    const result: SunatRunResult = {
      success: false,
      ruc,
      totalExtraidas: 0,
      notificaciones: [],
      pdfsPaths: [],
    };

    let browser: Browser | null = null;

    try {
      this.logger.log(`=== Iniciando extracción SUNAT para RUC ${ruc} ===`);

      // 1. Lanzar navegador (contexto aislado para SUNAT)
      const { browser: b, page } = await this.browserService.launchIsolated(headless);
      browser = b;

      // 2. Login
      await this.loginService.login(page, { ruc, usuarioSol, claveSol });
      this.logger.success('Login SUNAT exitoso.');

      // 3. Navegar al Buzón Electrónico
      await this.buzonService.navigateToBuzon(page);

      // 4. Localizar el frame del buzón
      const buzonFrame = await this.buzonService.findBuzonFrame(page);
      if (!buzonFrame) {
        throw new Error(
          'No se pudo detectar el frame del Buzón Electrónico de SUNAT tras esperar 15s.',
        );
      }
      this.logger.log(`Frame de buzón detectado: ${buzonFrame.url()}`);

      // 5. Extraer notificaciones (y PDFs si está habilitado)
      const notificaciones = await this.extractor.extractFromBuzon(buzonFrame, {
        ruc,
        descargarPdfs,
        existingFileIds: new Set<string>(),
      });

      result.notificaciones = notificaciones;
      result.totalExtraidas = notificaciones.length;
      result.pdfsPaths = notificaciones
        .filter((n) => n.pdfPath)
        .map((n) => n.pdfPath as string);

      result.success = true;
      this.logger.success(
        `Extracción SUNAT completada para ${ruc}. Total: ${result.totalExtraidas} notificaciones, ${result.pdfsPaths.length} PDFs descargados.`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error en extracción SUNAT para ${ruc}`, error);
      result.error = err.message ?? String(error);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
        this.logger.log('Navegador cerrado.');
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }
}
