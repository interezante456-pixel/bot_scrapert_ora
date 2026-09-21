/**
 * SunatLogin — Motor de scraping BES
 * Portado de loginToSunat() + handleSunatPopups() en sunat-scraper.service.ts
 * Login al portal SUNAT con reintentos y manejo de popups post-login.
 */

import { Page } from 'puppeteer';
import { Logger } from '../shared/logger';
import { sleep } from '../shared/utils';

export interface SunatCredentials {
  ruc: string;
  usuarioSol: string;
  claveSol: string;
}

export class SunatLogin {
  private readonly logger = new Logger('SunatLogin');

  private readonly sunatPortalUrl =
    'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm';

  /**
   * Realiza el login completo en el portal SUNAT.
   * Incluye 3 reintentos de conexión y manejo de popups post-login.
   */
  async login(page: Page, credentials: SunatCredentials): Promise<void> {
    const { ruc, usuarioSol, claveSol } = credentials;
    this.logger.log(`Navegando a SUNAT para RUC ${ruc}`);

    // 1. Navegación con reintentos
    let connected = false;
    for (let i = 0; i < 3; i++) {
      try {
        await page.goto(this.sunatPortalUrl, {
          waitUntil: 'networkidle0',
          timeout: 60000,
        });
        connected = true;
        break;
      } catch {
        this.logger.warn(`Intento ${i + 1} fallido (RUC ${ruc}), reintentando en 5s...`);
        await sleep(5000);
      }
    }

    if (!connected) {
      throw new Error('No se pudo establecer conexión con SUNAT tras varios intentos.');
    }

    // 2. Rellenar formulario
    await page.waitForSelector('#txtRuc', { timeout: 20000 });
    await page.type('#txtRuc', ruc);
    await page.type('#txtUsuario', usuarioSol);
    await page.type('#txtContrasena', claveSol);
    await sleep(1000);

    this.logger.log('Haciendo clic y esperando dashboard principal de SUNAT...');
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
        .catch(() => null),
      page.click('#btnAceptar'),
    ]);

    // 3. Manejo de popups post-login
    await this.handlePopups(page);

    const isLogged = await page.evaluate(
      () => !!document.querySelector('#aBuzon, .icon-buzon, [title*="Buzón"]'),
    );
    if (!isLogged) {
      this.logger.warn('⚠️ No se detectó el buzón tras el login, posible pantalla extra...');
    }
    await sleep(2000);
  }

  /**
   * Maneja ventanas emergentes o pantallas de validación que SUNAT muestra post-login.
   */
  async handlePopups(page: Page): Promise<void> {
    this.logger.log('Comprobando ventanas emergentes post-login en todos los frames...');
    try {
      await sleep(4500);
      const frames = page.frames();
      this.logger.log(`Detectados ${frames.length} frames en total.`);

      // 1. Detectar y presionar 'Finalizar'
      let clickedFinalizar = false;
      for (const frame of frames) {
        try {
          const clicked = await frame.evaluate(() => {
            const selectors = [
              'button',
              'input[type="button"]',
              'a',
              '[role="button"]',
              'span',
              'div',
            ];
            for (const selector of selectors) {
              const elements = Array.from(document.querySelectorAll(selector));
              const btn = elements.find((el) => {
                const text = el.textContent?.trim().toUpperCase() || '';
                return text.includes('FINALIZAR') && text.length < 20;
              });
              if (btn) {
                (btn as HTMLElement).click();
                return true;
              }
            }
            return false;
          });
          if (clicked) {
            clickedFinalizar = true;
            this.logger.log(`Botón "Finalizar" presionado en frame: ${frame.url()}`);
            break;
          }
        } catch {
          // Ignorar errores de CORS en frames remotos
        }
      }

      if (clickedFinalizar) await sleep(3000);

      // 2. Detectar y presionar 'Continuar sin confirmar'
      let clickedContinuar = false;
      for (const frame of page.frames()) {
        try {
          const clicked = await frame.evaluate(() => {
            const selectors = [
              'button',
              'input[type="button"]',
              'a',
              '[role="button"]',
              'span',
              'div',
            ];
            for (const selector of selectors) {
              const elements = Array.from(document.querySelectorAll(selector));
              const btn = elements.find((el) => {
                const text = el.textContent?.trim().toUpperCase() || '';
                return (
                  text.includes('CONTINUAR SIN CONFIRMAR') ||
                  (text.includes('CONTINUAR') && text.length < 30)
                );
              });
              if (btn) {
                (btn as HTMLElement).click();
                return true;
              }
            }
            return false;
          });
          if (clicked) {
            clickedContinuar = true;
            this.logger.log(
              `Botón "Continuar sin confirmar" presionado en frame: ${frame.url()}`,
            );
            break;
          }
        } catch {
          // Ignorar
        }
      }

      if (clickedContinuar) await sleep(4500);

      // 3. Cerrar avisos genéricos
      for (const frame of page.frames()) {
        try {
          const closed = await frame.evaluate(() => {
            const closeBtn = document.querySelector(
              'button[aria-label="Close"], .modal-header .close, #btnCerrarAviso',
            ) as HTMLElement | null;
            if (closeBtn) {
              closeBtn.click();
              return true;
            }
            return false;
          });
          if (closed) {
            this.logger.log(`Aviso/modal genérico cerrado en frame: ${frame.url()}`);
            await sleep(1500);
            break;
          }
        } catch {
          // Ignorar
        }
      }
    } catch (e) {
      this.logger.warn(`Error al manejar popups de SUNAT: ${(e as Error).message}`);
    }
  }
}
