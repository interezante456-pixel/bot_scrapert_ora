/**
 * SunatExtractor — Motor de scraping BES
 * Extrae la lista de notificaciones del Buzón Electrónico de SUNAT
 * y descarga los PDFs encontrados directamente desde el navegador.
 *
 * Portado del núcleo de checkBuzonForEmpresa() en sunat-scraper.service.ts
 */

import { Frame } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../shared/logger';
import { cleanUtf8, sleep, resolveOutputDir, sanitizeFilename } from '../shared/utils';
import { SunatNotificacion } from '../shared/types';

export interface ExtractOptions {
  ruc: string;
  /** Si se deben descargar los PDFs. Default: true */
  descargarPdfs?: boolean;
  /** fileIds ya conocidos para idempotencia (no re-descargar) */
  existingFileIds?: Set<string>;
  /** Año límite — solo procesar notificaciones del año actual. Default: año actual */
  filterYear?: number;
}

export class SunatExtractor {
  private readonly logger = new Logger('SunatExtractor');

  /**
   * Extrae todas las notificaciones del buzón de SUNAT y opcionalmente descarga sus PDFs.
   * @param mainFrame Frame del buzón (resultado de SunatBuzon.findBuzonFrame)
   * @param options   Opciones de extracción
   */
  async extractFromBuzon(
    mainFrame: Frame,
    options: ExtractOptions,
  ): Promise<SunatNotificacion[]> {
    const { ruc, descargarPdfs = true, existingFileIds = new Set(), filterYear } = options;
    const anoActual = filterYear ?? new Date().getFullYear();

    this.logger.log(`Iniciando extracción del Buzón para RUC ${ruc} (año ${anoActual})...`);

    // Preparar directorio de salida para PDFs
    const outputDir = resolveOutputDir(`sunat/${ruc}`);

    // Suprimir diálogos de impresión del visor SUNAT
    await mainFrame.evaluate(() => {
      window.print = () => {};
    });

    // ─── EVALUACIÓN MASIVA: encontrar filas con patrón de fecha ───
    const containersHandles = await mainFrame.evaluateHandle(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const uniqueRows = new Set<HTMLElement>();

      for (const node of elements) {
        const text = (node as HTMLElement).innerText || '';
        if (
          /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(text.trim()) &&
          node.childNodes.length <= 1
        ) {
          let p = (node as HTMLElement).parentElement;
          while (p && p.tagName !== 'TR' && p.tagName !== 'LI' && !p.className.includes('row')) {
            p = p.parentElement;
          }
          if (p) uniqueRows.add(p);
        }
      }
      return Array.from(uniqueRows);
    });

    const properties = await containersHandles.getProperties();
    const containersArray = [];
    for (const property of properties.values()) {
      const element = property.asElement();
      if (element) containersArray.push(element);
    }

    this.logger.log(`Detectadas ${containersArray.length} filas en el buzón.`);

    const notificaciones: SunatNotificacion[] = [];
    let lastFileId = '';
    let consecutivasAnioAnterior = 0;

    for (const container of containersArray) {
      try {
        // 1. Leer datos básicos de la fila
        const rowData = await (container as any).evaluate((node: HTMLElement) => ({
          fullText: node.innerText,
          asunto:
            node.querySelector('.asunto, [class*="asunto"], b, strong')?.textContent ||
            node.innerText.split('\n')[0],
        }));

        const rowDateMatch =
          rowData.fullText.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/) ||
          rowData.fullText.match(/(\d{2}\/\d{2}\/\d{4})/);

        if (!rowDateMatch) {
          this.logger.warn('No se pudo extraer fecha de la fila. Saltando.');
          continue;
        }

        // 2. Parsear fecha
        const parts = rowDateMatch[1].includes(':')
          ? rowDateMatch[1].split(/[\s\/:]/g)
          : [...rowDateMatch[1].split('/'), '0', '0', '0'];

        const rowFecha = new Date(
          parseInt(parts[2]),
          parseInt(parts[1]) - 1,
          parseInt(parts[0]),
          parseInt(parts[3] ?? '0'),
          parseInt(parts[4] ?? '0'),
          parseInt(parts[5] ?? '0'),
        );

        // 3. Filtro de año
        if (rowFecha.getFullYear() < anoActual) {
          consecutivasAnioAnterior++;
          if (consecutivasAnioAnterior >= 2) {
            this.logger.log('2 filas consecutivas del año anterior. Deteniendo escaneo.');
            break;
          }
          continue;
        }
        consecutivasAnioAnterior = 0;

        // 4. Hacer clic en la fila para cargar el detalle/PDF
        await (container as any).evaluate((node: HTMLElement) => {
          node.scrollIntoView();
          const link = node.querySelector('a, span');
          if (link) (link as HTMLElement).click();
          node.click();
        });

        // 5. Esperar que el visor cargue y extraer el fileId
        let currentId = '';
        for (let i = 0; i < 6; i++) {
          await sleep(2000);
          currentId = await mainFrame.evaluate(() => {
            const match = document.body.innerHTML.match(/bajarArchivo\/(\d{9,13})/);
            return match ? match[1] : '';
          });
          if (currentId && currentId !== lastFileId) break;
        }
        lastFileId = currentId;

        // 6. Verificar idempotencia
        if (currentId && existingFileIds.has(currentId)) {
          this.logger.log(`🛑 FileId ${currentId} ya existe. Deteniendo escaneo.`);
          break;
        }

        const asunto = cleanUtf8(rowData.asunto.trim());
        const notif: SunatNotificacion = {
          fileId: currentId || `SUNAT-${Date.now()}`,
          asunto: asunto.toUpperCase().includes('ASUNTO:') ? asunto : `ASUNTO: ${asunto}`,
          fechaMensaje: rowFecha,
          estado: 'NO_LEIDO',
        };

        // 7. Descarga del PDF si está habilitado
        if (descargarPdfs && currentId) {
          const pdfPath = await this.downloadPdf(mainFrame, currentId, ruc, outputDir, asunto);
          if (pdfPath) {
            notif.pdfPath = pdfPath;
            notif.pdfDescargado = true;
          } else {
            // Intentar con ID alternativo
            const altPath = await this.tryAlternativePdf(
              mainFrame,
              currentId,
              ruc,
              outputDir,
              asunto,
            );
            if (altPath) {
              notif.pdfPath = altPath;
              notif.pdfDescargado = true;
              notif.fileId = path.basename(altPath, '.pdf');
            }
          }
        }

        notificaciones.push(notif);
      } catch (err) {
        this.logger.error('Error procesando una fila del buzón', err);
      }
    }

    this.logger.log(`Extracción completada: ${notificaciones.length} notificaciones procesadas.`);
    return notificaciones;
  }

  /**
   * Descarga el PDF de una notificación SUNAT usando el internalId del visor.
   * Estrategia primaria: escaneo profundo del DOM incluyendo iframes anidados.
   */
  private async downloadPdf(
    mainFrame: Frame,
    currentId: string,
    ruc: string,
    outputDir: string,
    asunto: string,
  ): Promise<string | null> {
    try {
      const docInfo = await mainFrame.evaluate(() => {
        let allElements = Array.from(document.querySelectorAll('a, span, u, b, div'));

        // Atravesar iframes anidados (visor interno de SUNAT)
        document.querySelectorAll('iframe').forEach((iframe) => {
          try {
            if (iframe.contentDocument) {
              const iframeElements = Array.from(
                iframe.contentDocument.querySelectorAll('a, span, u, b, div'),
              );
              allElements = allElements.concat(iframeElements);
            }
          } catch {
            /* CORS block */
          }
        });

        for (const el of allElements) {
          const text = el.textContent?.trim().toLowerCase() || '';
          const html = el.outerHTML?.toLowerCase() || '';

          // Filtrar elementos de constancia
          if (text.includes('constancia') || html.includes('constancia')) continue;

          const idMatch = html.match(
            /(?:bajararchivo(?:\/|['"]|%27)|goarchivodescarga\s*\(\s*['"']?)([\d]{8,15})/i,
          );
          if (idMatch?.[1]) {
            const textNumber = text.match(/\b([a-z0-9-]*\d{5,}[a-z0-9-]*)\b/i);
            const visualId = textNumber ? textNumber[0].toUpperCase() : idMatch[1];
            return { internalId: idMatch[1], visualId };
          }
        }
        return null;
      });

      if (docInfo?.internalId) {
        const sunatUrl = `https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/bajarArchivo/${docInfo.internalId}/0/0/${ruc}`;
        return await this.fetchAndSavePdf(mainFrame, sunatUrl, docInfo.internalId, outputDir);
      }
    } catch (err) {
      this.logger.warn(`Error en descarga primaria: ${(err as Error).message}`);
    }
    return null;
  }

  /**
   * Estrategia alternativa: busca IDs diferentes al currentId en el HTML crudo.
   */
  private async tryAlternativePdf(
    mainFrame: Frame,
    currentId: string,
    ruc: string,
    outputDir: string,
    asunto: string,
  ): Promise<string | null> {
    try {
      this.logger.log('Segundo escaneo: buscando IDs alternativos en el HTML crudo...');
      const allIds = await mainFrame.evaluate(() => {
        const matches = document.body.innerHTML.match(/bajarArchivo\/(\d{8,15})/g);
        if (!matches) return [];
        return matches
          .map((m) => m.match(/(\d{8,15})/)?.[1] ?? '')
          .filter((id) => id !== '');
      });

      const alternativeId = allIds.find(
        (id: string) => id !== currentId && id !== ruc,
      );

      if (alternativeId) {
        this.logger.log(`ID alternativo encontrado: ${alternativeId}`);
        const sunatUrl = `https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/bajarArchivo/${alternativeId}/0/0/${ruc}`;
        return await this.fetchAndSavePdf(mainFrame, sunatUrl, alternativeId, outputDir);
      }
    } catch (err) {
      this.logger.warn(`Error en descarga alternativa: ${(err as Error).message}`);
    }
    return null;
  }

  /**
   * Hace fetch del PDF desde el browser context y lo guarda en disco.
   */
  private async fetchAndSavePdf(
    mainFrame: Frame,
    sunatUrl: string,
    fileId: string,
    outputDir: string,
  ): Promise<string | null> {
    const base64Data = await mainFrame.evaluate(async (url: string) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }, sunatUrl);

    if (base64Data && base64Data.includes(',')) {
      const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
      if (buffer.length > 1000 || buffer.toString('utf8', 0, 4) === '%PDF') {
        const fileName = `${fileId}.pdf`;
        const filePath = path.join(outputDir, fileName);
        await fs.promises.writeFile(filePath, buffer);
        this.logger.success(`PDF guardado: ${filePath}`);
        return filePath;
      }
      this.logger.warn(`Buffer inválido para fileId ${fileId} (${buffer.length} bytes)`);
    }
    return null;
  }
}
