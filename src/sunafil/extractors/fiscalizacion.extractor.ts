import { Page } from 'puppeteer';
import { BaseSunafilExtractor } from './base.extractor';
import { BaseSunafilRecord, ModuloSunafil } from '../interfaces/sunafil.types';

export class FiscalizacionExtractor extends BaseSunafilExtractor {
  async extract(page: Page): Promise<BaseSunafilRecord[]> {
    this.logger.log('Extrayendo notificaciones de Fiscalización...');
    const rawRows = await this.getMainTableRows(page);
    const records: BaseSunafilRecord[] = [];

    for (const row of rawRows) {
      if (!this.isValidDataRow(row.cells) || row.cells.length < 3) continue;

      const ordenInspeccion = row.cells[0] || '';
      const intendencia = row.cells[1] || '';
      const estado = row.cells[2] || 'LEÍDO';

      if (!ordenInspeccion) continue;

      records.push({
        modulo: ModuloSunafil.FISCALIZACION,
        codigoReferencia: ordenInspeccion,
        intendencia,
        asunto: `Fiscalización Laboral - Orden: ${ordenInspeccion}`,
        estado: estado.toUpperCase(),
        tienePdf: row.hasDocBtn,
        docActionSelector: `table tbody tr:nth-child(${row.rowIndex + 1}) td:last-child button, table tbody tr:nth-child(${row.rowIndex + 1}) td:last-child a`,
        pdfDescargado: false,
        metadataExtra: { ordenInspeccion, intendencia },
      });
    }

    this.logger.log(`Fiscalización: ${records.length} notificaciones encontradas.`);
    return records;
  }
}
