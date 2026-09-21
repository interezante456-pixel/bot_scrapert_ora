/**
 * BrowserService — Motor de scraping BES
 *
 * Portado de backend/src/scraper/shared/browser.service.ts
 * Cambio principal: headless = FALSE por defecto (navegador visible en pantalla).
 * Toggle con variable de entorno HEADLESS=true o flag --headless en CLI.
 */

import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer';
import { Logger } from '../shared/logger';

export interface BrowserSession {
  browser: Browser;
  page: Page;
}

export class BrowserService {
  private readonly logger = new Logger('BrowserService');

  /**
   * Argumentos de Chrome compartidos por SUNAT y SUNAFIL.
   * Sin --headless aquí — se controla en el objeto de launch.
   */
  private get chromeArgs(): string[] {
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--incognito',
      '--disable-features=PasswordLeakDetection,AutofillServerCommunication',
      '--disable-save-password-bubble',
      '--password-store=basic',
    ];
  }

  private get userAgent(): string {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  /**
   * Determina el modo headless.
   * Orden de precedencia:
   *   1. parámetro explícito pasado al método
   *   2. variable de entorno HEADLESS
   *   3. false (navegador VISIBLE por defecto)
   */
  private resolveHeadless(headlessOverride?: boolean): boolean {
    if (headlessOverride !== undefined) return headlessOverride;
    const envVal = process.env.HEADLESS?.replace(/['"]/g, '').trim().toLowerCase();
    if (envVal === 'true' || envVal === '1') return true;
    return false; // ← VISIBLE por defecto en el motor independiente
  }

  private getExecutablePath(): string | undefined {
    const p = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    return p && p.length > 0 ? p : undefined;
  }

  /**
   * Lanza un browser con contexto AISLADO (BrowserContext propio).
   * Uso: SUNAT — garantiza aislamiento total de cookies entre sesiones.
   */
  async launchIsolated(headless?: boolean): Promise<BrowserSession> {
    const isHeadless = this.resolveHeadless(headless);
    this.logger.log(`Iniciando Puppeteer (aislado). Headless: ${isHeadless}`);

    const browser = await puppeteer.launch({
      executablePath: this.getExecutablePath(),
      headless: isHeadless,
      defaultViewport: isHeadless ? { width: 1920, height: 1080 } : null,
      args: this.chromeArgs,
    });

    const context: BrowserContext = await browser.createBrowserContext();
    const page = await context.newPage();
    this.configPage(page);
    return { browser, page };
  }

  /**
   * Lanza un browser con página directa sobre el contexto por defecto.
   * Uso: SUNAFIL — más ligero, el aislamiento lo gestiona la lógica de auth.
   */
  async launchSimple(headless?: boolean): Promise<BrowserSession> {
    const isHeadless = this.resolveHeadless(headless);
    this.logger.log(`Iniciando Puppeteer (simple). Headless: ${isHeadless}`);

    const browser = await puppeteer.launch({
      executablePath: this.getExecutablePath(),
      headless: isHeadless,
      defaultViewport: isHeadless ? { width: 1920, height: 1080 } : null,
      args: this.chromeArgs,
    });

    const page = await browser.newPage();
    this.configPage(page);
    return { browser, page };
  }

  /**
   * Configura una página con ajustes estándar:
   * timeout, User-Agent, headers de idioma y handler de diálogos.
   */
  private configPage(page: Page): void {
    page.setDefaultNavigationTimeout(60000);
    void page.setUserAgent(this.userAgent);
    void page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });

    page.on('dialog', async (dialog) => {
      this.logger.log(
        `Diálogo detectado [${dialog.type()}]: "${dialog.message()}". Aceptando...`,
      );
      await dialog.accept();
    });
  }
}
