/**
 * SunatBuzon — Motor de scraping BES
 * Portado de navigateToBuzon() + findBuzonFrame() de sunat-scraper.service.ts
 * Navega al Buzón Electrónico de SUNAT y localiza el frame correcto.
 */

import { Page, Frame } from 'puppeteer';
import { Logger } from '../shared/logger';
import { sleep } from '../shared/utils';

export class SunatBuzon {
  private readonly logger = new Logger('SunatBuzon');

  /**
   * Navega al Buzón Electrónico desde el panel principal de SUNAT.
   */
  async navigateToBuzon(page: Page): Promise<void> {
    this.logger.log('Navegando automáticamente al Buzón Electrónico...');
    try {
      const closeButton = await page.$(
        'button[aria-label="Close"], .modal-header .close, #btnCerrarAviso',
      );
      if (closeButton) await closeButton.click();

      const buzonButton = await page.evaluateHandle(() =>
        [...document.querySelectorAll('a, button')].find((el) =>
          el.textContent?.includes('Buzón Electrónico'),
        ),
      );

      if (buzonButton && (buzonButton as any).asElement()) {
        await (buzonButton as any).asElement().click();
      } else {
        await page.waitForSelector('#aBuzon, .icon-buzon, [title*="Buzón"]', {
          timeout: 5000,
        });
        await page.click('#aBuzon, .icon-buzon, [title*="Buzón"]');
      }
    } catch {
      await page.goto(
        'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*',
        { waitUntil: 'networkidle2' },
      );
    }

    // Espera inteligente: aguarda hasta que aparezca el contenedor del buzón
    try {
      await page.waitForSelector(
        '#divMensaje, .list-group, iframe[src*="visor"], iframe[src*="master"], iframe[src*="notifica"], iframe[src*="buzon"], #tablaBuzon, [title*="Buzón"]',
        { timeout: 15000 },
      );
    } catch {
      this.logger.warn('waitForSelector de buzón no encontró selector en 15s — aplicando margen de 3s.');
    }

    await sleep(3000);
  }

  /**
   * Busca de forma reactiva el frame donde SUNAT renderiza el Buzón.
   * Examina URLs conocidas y elementos distintivos dentro del DOM de cada frame.
   */
  async findBuzonFrame(page: Page): Promise<Frame | null> {
    const startTime = Date.now();
    const maxWaitMs = 15000;

    while (Date.now() - startTime < maxWaitMs) {
      const frames = page.frames();

      // 1. Buscar coincidencia por URL
      const frameByUrl = frames.find((f) => {
        const url = f.url().toLowerCase();
        return (
          url.includes('visor') ||
          url.includes('master') ||
          url.includes('notifica') ||
          url.includes('buzon') ||
          url.includes('mensaje')
        );
      });
      if (frameByUrl) return frameByUrl;

      // 2. Buscar inspeccionando el contenido de cada frame
      for (const f of frames) {
        try {
          const hasBuzonElements = await f.evaluate(() => {
            const bodyText = document.body ? document.body.innerText || '' : '';
            return !!(
              document.querySelector('#divDetalleMensaje') ||
              document.querySelector('#tablaBuzon') ||
              document.querySelector('a[href*="bajarArchivo"]') ||
              bodyText.includes('Buzón Notificaciones') ||
              bodyText.includes('Buzón Mensajes') ||
              /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(bodyText)
            );
          });
          if (hasBuzonElements) return f;
        } catch {
          // Ignorar frames cerrados o inaccesibles
        }
      }

      await sleep(1000);
    }

    // 3. Fallback: verificar si el frame principal contiene el buzón
    try {
      const mainHasBuzon = await page.evaluate(() => {
        const bodyText = document.body ? document.body.innerText || '' : '';
        return !!(
          document.querySelector('#divDetalleMensaje') ||
          document.querySelector('#tablaBuzon') ||
          bodyText.includes('Buzón Notificaciones') ||
          bodyText.includes('Buzón Mensajes')
        );
      });
      if (mainHasBuzon) return page.mainFrame();
    } catch {}

    return null;
  }
}
