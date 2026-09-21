import { Page } from 'puppeteer';
import { BaseSunafilExtractor } from './base.extractor';
import { BaseSunafilRecord, ModuloSunafil } from '../interfaces/sunafil.types';

export class FormalizacionExtractor extends BaseSunafilExtractor {
  async extract(page: Page): Promise<BaseSunafilRecord[]> {
    this.logger.log('Extrayendo notificaciones de Alertas de Formalización...');
    const rawRows = await this.getMainTableRows(page);
    const records: BaseSunafilRecord[] = [];

    for (const row of rawRows) {
      if (!this.isValidDataRow(row.cells) || row.cells.length < 5) continue;

      const categoria = row.cells[0] || 'FORMALIZACIÓN';
      const fechaDepositoStr = row.cells[1] || '';
      const fechaNotificacionStr = row.cells[2] || '';
      const fechaLimiteRespuestaStr = row.cells[3] || '';
      const asunto = row.cells[4] || 'Alerta de Formalización Laboral';
      const trabajadoresStr = row.cells[5] || '';

      const trabajadores = parseInt(trabajadoresStr.replace(/\D/g, ''), 10);
      const codigoRef = `FORMALIZACION-${fechaNotificacionStr.replace(/\//g, '')}-${asunto.substring(0, 15).replace(/\s+/g, '')}`;

      records.push({
        modulo: ModuloSunafil.ALERTAS_FORMALIZACION,
        codigoReferencia: codigoRef,
        asunto: `Formalización: ${asunto}`,
        estado: 'PENDIENTE',
        fechaDeposito: this.parseDate(fechaDepositoStr),
        fechaNotificacion: this.parseDate(fechaNotificacionStr),
        fechaLimite: this.parseDate(fechaLimiteRespuestaStr),
        trabajadoresIncorporados: isNaN(trabajadores) ? null : trabajadores,
        tienePdf: row.hasDocBtn,
        docActionSelector: `table tbody tr:nth-child(${row.rowIndex + 1}) td:nth-last-child(2) button, table tbody tr:nth-child(${row.rowIndex + 1}) td:nth-last-child(2) a`,
        pdfDescargado: false,
        metadataExtra: {
          categoria,
          trabajadoresIncorporados: isNaN(trabajadores) ? null : trabajadores,
          fechaLimiteRespuesta: fechaLimiteRespuestaStr,
        },
      });
    }

    this.logger.log(`Alertas Formalización: ${records.length} notificaciones encontradas.`);
    return records;
  }
}
