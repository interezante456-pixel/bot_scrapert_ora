import { Page } from 'puppeteer';
import { BaseSunafilExtractor } from './base.extractor';
import { BaseSunafilRecord, ModuloSunafil } from '../interfaces/sunafil.types';

export class SstExtractor extends BaseSunafilExtractor {
  async extract(page: Page): Promise<BaseSunafilRecord[]> {
    this.logger.log('Extrayendo notificaciones de Alertas SST...');
    const rawRows = await this.getMainTableRows(page);
    const records: BaseSunafilRecord[] = [];

    for (const row of rawRows) {
      if (!this.isValidDataRow(row.cells) || row.cells.length < 4) continue;

      const categoria = row.cells[0] || 'SST';
      const fechaDepositoStr = row.cells[1] || '';
      const fechaNotificacionStr = row.cells[2] || '';
      const asunto = row.cells[3] || 'Alerta de Seguridad y Salud en el Trabajo';
      const estado = row.cells.length >= 5 ? row.cells[4] : 'LEÍDO';

      const codigoRef = `SST-${fechaNotificacionStr.replace(/\//g, '')}-${asunto.substring(0, 15).replace(/\s+/g, '')}`;

      records.push({
        modulo: ModuloSunafil.ALERTAS_SST,
        codigoReferencia: codigoRef,
        asunto: `SST: ${asunto}`,
        estado: (estado || 'LEÍDO').toUpperCase(),
        fechaDeposito: this.parseDate(fechaDepositoStr),
        fechaNotificacion: this.parseDate(fechaNotificacionStr),
        tienePdf: row.hasDocBtn,
        docActionSelector: `table tbody tr:nth-child(${row.rowIndex + 1}) td:last-child button, table tbody tr:nth-child(${row.rowIndex + 1}) td:last-child a`,
        pdfDescargado: false,
        metadataExtra: { categoria },
      });
    }

    this.logger.log(`Alertas SST: ${records.length} notificaciones encontradas.`);
    return records;
  }
}
