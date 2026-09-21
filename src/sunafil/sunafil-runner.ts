/**
 * SunafilRunner — Motor de scraping BES
 * Orquestador principal de la extracción de notificaciones de SUNAFIL.
 * Ejecuta: login → navegar 5 módulos → extraer tablas → devolver resultado JSON.
 */

import { Browser } from 'puppeteer';
import { BrowserService } from '../browser/browser.service';
import { SunafilAuthService, SunafilTermsNotAcceptedError, SunafilContactRegistrationRequiredError } from './sunafil-auth';
import { SunafilNavigator } from './sunafil-navigator';
import { FiscalizacionExtractor } from './extractors/fiscalizacion.extractor';
import { CobranzaExtractor } from './extractors/cobranza.extractor';
import { AccionesPreviasExtractor } from './extractors/acciones-previas.extractor';
import { FormalizacionExtractor } from './extractors/formalizacion.extractor';
import { SstExtractor } from './extractors/sst.extractor';
import { BaseSunafilRecord } from './interfaces/sunafil.types';
import { SunafilRunInput, SunafilRunResult } from '../shared/types';
import { Logger } from '../shared/logger';

export class SunafilRunner {
  private readonly logger = new Logger('SunafilRunner');

  private readonly browserService = new BrowserService();
  private readonly authService = new SunafilAuthService();
  private readonly navigator = new SunafilNavigator();

  private readonly fiscalizacionExtractor = new FiscalizacionExtractor();
  private readonly cobranzaExtractor = new CobranzaExtractor();
  private readonly accionesPreviasExtractor = new AccionesPreviasExtractor();
  private readonly formalizacionExtractor = new FormalizacionExtractor();
  private readonly sstExtractor = new SstExtractor();

  /**
   * Ejecuta la extracción completa de notificaciones SUNAFIL para un RUC.
   */
  async run(input: SunafilRunInput): Promise<SunafilRunResult> {
    const startTime = Date.now();
    const { ruc, usuarioSol, claveSol, headless, modulos } = input;

    const result: SunafilRunResult = {
      success: false,
      ruc,
      totalExtraidas: 0,
      porModulo: {
        fiscalizacion: 0,
        cobranza: 0,
        accionesPrevias: 0,
        formalizacion: 0,
        sst: 0,
      },
      notificaciones: [],
    };

    const allRecords: BaseSunafilRecord[] = [];
    let browser: Browser | null = null;

    try {
      this.logger.log(`=== Iniciando extracción SUNAFIL para RUC ${ruc} ===`);
      const { browser: b, page } = await this.browserService.launchSimple(headless);
      browser = b;

      // 1. Autenticación Clave SOL
      await this.authService.login(page, ruc, usuarioSol, claveSol);
      this.logger.success('Login SUNAFIL exitoso.');

      const shouldRun = (mod: string) =>
        !modulos || modulos.length === 0 || modulos.includes(mod as never);

      // 2. Módulo 1: Fiscalización
      if (shouldRun('FISCALIZACION')) {
        try {
          await this.navigator.navigateToMenu(
            page,
            'Fiscalización',
            'Notificaciones de Fiscalización',
          );
          const recs = await this.fiscalizacionExtractor.extract(page);
          result.porModulo.fiscalizacion = recs.length;
          allRecords.push(...recs);
        } catch (err) {
          this.logger.error('Error al extraer Fiscalización', err);
        }
      }

      // 3. Módulo 2: Cobranza
      if (shouldRun('COBRANZA')) {
        try {
          await this.navigator.navigateToMenu(
            page,
            'Cobranza',
            'Notificaciones de Cobranza',
          );
          const recs = await this.cobranzaExtractor.extract(page);
          result.porModulo.cobranza = recs.length;
          allRecords.push(...recs);
        } catch (err) {
          this.logger.error('Error al extraer Cobranza', err);
        }
      }

      // 4. Módulo 3: Acciones Previas
      if (shouldRun('ACCIONES_PREVIAS')) {
        try {
          await this.navigator.navigateToMenu(
            page,
            'Acciones Previas',
            'Acciones Previas',
          );
          const recs = await this.accionesPreviasExtractor.extract(page);
          result.porModulo.accionesPrevias = recs.length;
          allRecords.push(...recs);
        } catch (err) {
          this.logger.error('Error al extraer Acciones Previas', err);
        }
      }

      // 5. Módulo 4: Alertas → Formalización
      if (shouldRun('ALERTAS_FORMALIZACION')) {
        try {
          await this.navigator.navigateToMenu(page, 'Alertas', 'Formalización');
          const recs = await this.formalizacionExtractor.extract(page);
          result.porModulo.formalizacion = recs.length;
          allRecords.push(...recs);
        } catch (err) {
          this.logger.error('Error al extraer Formalización', err);
        }
      }

      // 6. Módulo 5: Alertas → SST
      if (shouldRun('ALERTAS_SST')) {
        try {
          await this.navigator.navigateToMenu(
            page,
            'Alertas',
            'Seguridad y Salud en el Trabajo',
          );
          const recs = await this.sstExtractor.extract(page);
          result.porModulo.sst = recs.length;
          allRecords.push(...recs);
        } catch (err) {
          this.logger.error('Error al extraer SST', err);
        }
      }

      result.notificaciones = allRecords;
      result.totalExtraidas = allRecords.length;
      result.success = true;

      this.logger.success(
        `Extracción SUNAFIL completada para ${ruc}. Total: ${result.totalExtraidas} notificaciones.`,
      );
    } catch (error) {
      if (error instanceof SunafilTermsNotAcceptedError) {
        this.logger.warn(`Empresa ${ruc} — Términos y Condiciones pendientes.`);
        result.error = error.message;
        result.requiresManualAction = true;
        result.requiresManualActionReason = 'TERMINOS_PENDIENTES';
      } else if (error instanceof SunafilContactRegistrationRequiredError) {
        this.logger.warn(`Empresa ${ruc} — Registro de contacto pendiente.`);
        result.error = error.message;
        result.requiresManualAction = true;
        result.requiresManualActionReason = 'CONTACTO_PENDIENTE';
      } else {
        const err = error as Error;
        this.logger.error(`Error en extracción SUNAFIL para ${ruc}`, error);
        result.error = err.message ?? String(error);
      }
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
