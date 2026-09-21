/**
 * BaseSunafilExtractor — Motor de scraping BES
 * Portado de backend/src/scraper/sunafil/extractors/base.extractor.ts
 * Sin dependencias de NestJS.
 */

import { Page } from 'puppeteer';
import { Logger } from '../../shared/logger';
import { BaseSunafilRecord } from '../interfaces/sunafil.types';

export abstract class BaseSunafilExtractor {
  protected readonly logger = new Logger(this.constructor.name);

  abstract extract(page: Page): Promise<BaseSunafilRecord[]>;

  /**
   * Obtiene las filas de la tabla principal de la página, excluyendo modales.
   */
  protected async getMainTableRows(
    page: Page,
  ): Promise<{ cells: string[]; rowIndex: number; hasDocBtn: boolean }[]> {
    await this.setMaxRecordsPerPage(page);

    return page.evaluate(() => {
      // 1. Eliminar cualquier modal restante que pueda interferir
      document.querySelectorAll('.modal, .modal-backdrop').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
        el.remove();
      });
      document.body.classList.remove('modal-open');

      // 2. Buscar la tabla principal del contenido (excluir tablas dentro de modales)
      const allTables = Array.from(document.querySelectorAll('table'));
      const mainTables = allTables.filter(
        (t) => !t.closest('.modal') && !t.closest('.modal-dialog'),
      );
      const targetTable = mainTables[0] || allTables[0];

      if (!targetTable) return [];

      const trs = Array.from(targetTable.querySelectorAll('tbody tr'));
      return trs.map((tr, index) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
          (td as HTMLElement).innerText.trim(),
        );
        const hasDocBtn = !!tr.querySelector(
          'button, a, .btn, .fa-file-pdf, [title*="Ver"], [title*="Documento"]',
        );
        return { cells, rowIndex: index, hasDocBtn };
      });
    });
  }

  /**
   * Verifica si una fila corresponde a un dato válido (no mensajes vacíos ni popups).
   */
  protected isValidDataRow(cells: string[]): boolean {
    if (!cells || cells.length === 0) return false;
    const firstCell = cells[0].toLowerCase();

    if (
      firstCell.includes('ningún dato') ||
      firstCell.includes('no data') ||
      firstCell.includes('sin registros')
    ) {
      return false;
    }

    if (
      firstCell.includes('notificaciones de fiscalización') ||
      firstCell.includes('notificaciones de cobranza') ||
      firstCell.includes('notificaciones de acciones previas') ||
      firstCell.includes('notificaciones de alertas') ||
      firstCell.includes('notificaciones de orientaciones') ||
      firstCell.includes('descripción')
    ) {
      return false;
    }

    return true;
  }

  /**
   * Intenta configurar la tabla para mostrar 100 registros por página.
   */
  protected async setMaxRecordsPerPage(page: Page): Promise<void> {
    try {
      const selectSelector =
        'select[name$="_length"], select.form-control, select[name*="length"]';
      await page.waitForSelector(selectSelector, { timeout: 4000 }).catch(() => {});

      const has100Option = await page.evaluate((sel: string) => {
        const select = document.querySelector(sel) as HTMLSelectElement | null;
        if (!select) return false;
        const options = Array.from(select.options).map((o) => o.value);
        return options.includes('100') || options.includes('50') || options.includes('25');
      }, selectSelector);

      if (has100Option) {
        await page.select(selectSelector, '100').catch(async () => {
          await page.select(selectSelector, '50').catch(async () => {
            await page.select(selectSelector, '25').catch(() => {});
          });
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      // Continuar si no se pudo cambiar el tamaño
    }
  }

  /**
   * Parsea cadenas de fecha en formato peruano 'DD/MM/YYYY' o 'DD/MM/YYYY HH:mm'.
   */
  protected parseDate(dateStr?: string): Date | null {
    if (!dateStr || !dateStr.trim()) return null;
    const cleanStr = dateStr.trim();

    const dateTimeMatch = cleanStr.match(
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (dateTimeMatch) {
      const [, day, month, year, hours, minutes, seconds] = dateTimeMatch;
      return new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hours, 10),
        parseInt(minutes, 10),
        seconds ? parseInt(seconds, 10) : 0,
      );
    }

    const dateMatch = cleanStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
    }

    return null;
  }
}
