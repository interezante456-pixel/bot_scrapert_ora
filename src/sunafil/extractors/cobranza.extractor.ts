import { Page } from 'puppeteer';
import { BaseSunafilExtractor } from './base.extractor';
import { BaseSunafilRecord, ModuloSunafil } from '../interfaces/sunafil.types';

export class CobranzaExtractor extends BaseSunafilExtractor {
  async extract(page: Page): Promise<BaseSunafilRecord[]> {
    this.logger.log('Extrayendo notificaciones de Cobranza...');
    const rawRows = await this.getMainTableRows(page);
    const records: BaseSunafilRecord[] = [];

    for (const row of rawRows) {
      if (!this.isValidDataRow(row.cells) || row.cells.length < 2) continue;

      const expedienteSancionador = row.cells[0] || '';
      const intendencia = row.cells[1] || '';
      const estado = row.cells.length >= 3 ? row.cells[2] : 'LEÍDO';

      if (!expedienteSancionador) continue;

      records.push({
        modulo: ModuloSunafil.COBRANZA,
        codigoReferencia: expedienteSancionador,
        intendencia,
        asunto: `Cobranza Ordinaria - Expediente: ${expedienteSancionador}`,
        estado: (estado || 'LEÍDO').toUpperCase(),
        tienePdf: row.hasDocBtn,
        docActionSelector: `table tbody tr:nth-child(${row.rowIndex + 1}) td:last-child button, table tbody tr:nth-child(${row.rowIndex + 1}) td:last-child a`,
        pdfDescargado: false,
        metadataExtra: { expedienteSancionador, intendencia },
      });
    }

    this.logger.log(`Cobranza: ${records.length} notificaciones encontradas.`);
    return records;
  }
}
