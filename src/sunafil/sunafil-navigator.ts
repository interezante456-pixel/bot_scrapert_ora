/**
 * SunafilNavigator — Motor de scraping BES
 * Portado de navigateToMenu() en sunafil-scraper.service.ts
 * Maneja la navegación entre los 5 módulos del sidebar de SUNAFIL.
 */

import { Page } from 'puppeteer';
import { Logger } from '../shared/logger';
import { sleep } from '../shared/utils';
import * as path from 'path';
import * as fs from 'fs';

export class SunafilNavigator {
  private readonly logger = new Logger('SunafilNavigator');

  /**
   * Navega a un módulo específico del menú lateral de SUNAFIL.
   * @param page       Página de Puppeteer
   * @param parentText Texto del menú padre (ej: 'Fiscalización')
   * @param subText    Texto del submenú (ej: 'Notificaciones de Fiscalización')
   */
  async navigateToMenu(
    page: Page,
    parentText: string,
    subText: string,
  ): Promise<void> {
    this.logger.log(`Navegando a menú: ${parentText} > ${subText}...`);

    // 1. Eliminar cualquier modal o backdrop residual
    await page.evaluate(() => {
      document.querySelectorAll('.modal, .modal-backdrop').forEach((m) => {
        (m as HTMLElement).style.display = 'none';
        m.remove();
      });
      document.body.classList.remove('modal-open');
    });

    // 2. Extraer el href del submenú
    const linkInfo = await page.evaluate(
      (parent: string, sub: string) => {
        const clean = (t: string) =>
          t
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        const pClean = clean(parent);
        const sClean = clean(sub);

        const allElements = Array.from(
          document.querySelectorAll('aside a, nav a, .sidebar a, ul a, a'),
        );
        let subLink = allElements.find((el) =>
          clean(el.textContent || '').includes(sClean),
        );

        // Si no se encuentra o no está visible, abrir acordeón padre
        if (!subLink) {
          const parentLink = allElements.find((el) =>
            clean(el.textContent || '').includes(pClean),
          );
          if (parentLink) (parentLink as HTMLElement).click();
        }

        // Reintentar encontrar sublink
        subLink = allElements.find((el) =>
          clean(el.textContent || '').includes(sClean),
        );
        if (subLink) {
          const href = (subLink as HTMLAnchorElement).getAttribute('href');
          return {
            found: true,
            href:
              href && href !== '#' && !href.startsWith('javascript:') ? href : null,
          };
        }

        return { found: false, href: null };
      },
      parentText,
      subText,
    );

    // 3. Navegar por URL directa si existe, o por clic
    if (linkInfo.href) {
      const currentOrigin = new URL(page.url()).origin;
      const targetUrl = linkInfo.href.startsWith('http')
        ? linkInfo.href
        : `${currentOrigin}${linkInfo.href.startsWith('/') ? '' : '/'}${linkInfo.href}`;
      this.logger.log(`Navegando a URL directa: ${targetUrl}`);
      await page
        .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 })
        .catch(() => {});
    } else {
      await page.evaluate((sub: string) => {
        const clean = (t: string) =>
          t
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const sClean = clean(sub);
        const allElements = Array.from(
          document.querySelectorAll('aside a, nav a, .sidebar a, ul a, a'),
        );
        const subLink = allElements.find((el) =>
          clean(el.textContent || '').includes(sClean),
        );
        if (subLink) (subLink as HTMLElement).click();
      }, subText);
    }

    // 4. Esperar a que la tabla o datos carguen
    await sleep(2000);
    await page
      .waitForSelector('table tbody tr', { timeout: 10000 })
      .catch(() => {});

    // 5. Captura de pantalla de depuración
    await this.takeDebugScreenshot(page, `modulo-${subText.replace(/[\s/]/g, '_').toLowerCase()}`);
  }

  /**
   * Toma una captura de pantalla de depuración y la guarda en output/sunafil-debug/.
   */
  async takeDebugScreenshot(page: Page, name: string): Promise<void> {
    try {
      const outputBase = process.env.OUTPUT_DIR ?? path.join(process.cwd(), 'output');
      const dir = path.join(outputBase, 'sunafil-debug');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${name}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      this.logger.debug(`📸 Captura guardada: ${filePath} (URL: ${page.url()})`);
    } catch (e) {
      this.logger.debug(`No se pudo tomar captura: ${(e as Error).message}`);
    }
  }
}
