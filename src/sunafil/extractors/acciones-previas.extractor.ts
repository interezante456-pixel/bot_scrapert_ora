import { Page } from 'puppeteer';
import { BaseSunafilExtractor } from './base.extractor';
import { BaseSunafilRecord, ModuloSunafil } from '../interfaces/sunafil.types';

export class AccionesPreviasExtractor extends BaseSunafilExtractor {
  async extract(page: Page): Promise<BaseSunafilRecord[]> {
    this.logger.log('Extrayendo notificaciones de Acciones Previas...');
    const rawRows = await this.getMainTableRows(page);
    const records: BaseSunafilRecord[] = [];

    for (const row of rawRows) {
      if (!this.isValidDataRow(row.cells) || row.cells.length < 5) continue;

      const tipoRequerimiento = row.cells[0] || '';
      const registro = row.cells[1] || '';
      const fechaDepositoStr = row.cells[2] || '';
      const fechaAcuseStr = row.cells[3] || '';
      const fechaNotificacionStr = row.cells[4] || '';
      const plazoStr = row.cells[5] || '';
      const fechaLimiteStr = row.cells[6] || '';

      if (!registro && !tipoRequerimiento) continue;

      const plazoDias = parseInt(plazoStr, 10);

      records.push({
        modulo: ModuloSunafil.ACCIONES_PREVIAS,
        codigoReferencia: registro || tipoRequerimiento,
        asunto: `${tipoRequerimiento} - Reg: ${registro}`,
        estado: 'PENDIENTE',
        fechaDeposito: this.parseDate(fechaDepositoStr),
        fechaAcuseRecibo: this.parseDate(fechaAcuseStr),
        fechaNotificacion: this.parseDate(fechaNotificacionStr),
        fechaLimite: this.parseDate(fechaLimiteStr),
        plazoDias: isNaN(plazoDias) ? null : plazoDias,
        tienePdf: row.hasDocBtn,
        docActionSelector: `table tbody tr:nth-child(${row.rowIndex + 1}) td:nth-last-child(2) a, table tbody tr:nth-child(${row.rowIndex + 1}) td:nth-last-child(2) button`,
        pdfDescargado: false,
        metadataExtra: {
          tipoRequerimiento,
          registro,
          plazoDias: isNaN(plazoDias) ? null : plazoDias,
          fechaLimiteOriginal: fechaLimiteStr,
        },
      });
    }

    this.logger.log(`Acciones Previas: ${records.length} notificaciones encontradas.`);
    return records;
  }
}
