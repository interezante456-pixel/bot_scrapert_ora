/**
 * SunafilAuthService — Motor de scraping BES
 * Portado de backend/src/scraper/sunafil/sunafil-auth.service.ts
 * Sin decoradores NestJS. Login Clave SOL para la Casilla Electrónica SUNAFIL.
 */

import { Page } from 'puppeteer';
import { Logger } from '../shared/logger';

export class SunafilTermsNotAcceptedError extends Error {
  constructor(
    message = 'Términos y Condiciones de la Casilla SUNAFIL no han sido aceptados por el titular.',
  ) {
    super(message);
    this.name = 'SunafilTermsNotAcceptedError';
  }
}

export class SunafilContactRegistrationRequiredError extends Error {
  constructor(
    message = 'La empresa no cuenta con contactos registrados en la Casilla Electrónica de SUNAFIL.',
  ) {
    super(message);
    this.name = 'SunafilContactRegistrationRequiredError';
  }
}

export class SunafilAuthService {
  private readonly logger = new Logger('SunafilAuth');

  private readonly sunafilLoginUrl =
    'https://api-seguridad.sunat.gob.pe/v1/clientessol/b6474e23-8a3b-4153-b301-dafcc9646250/oauth2/login?originalUrl=https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa&state=s';

  /**
   * Realiza el login Clave SOL para acceder a la Casilla Electrónica de SUNAFIL.
   */
  async login(
    page: Page,
    ruc: string,
    usuarioSol: string,
    claveSol: string,
  ): Promise<boolean> {
    this.logger.log(`Iniciando sesión para RUC ${ruc}...`);

    // 1. Navegación con reintentos
    let loaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(this.sunafilLoginUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
        loaded = true;
        break;
      } catch (err) {
        this.logger.warn(`Intento ${attempt} de carga fallido, reintentando en 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!loaded) {
      throw new Error(
        'No se pudo conectar con el portal de autenticación Clave SOL de SUNAT/SUNAFIL.',
      );
    }

    // 2. Esperar campos de login
    await page.waitForSelector(
      'input[name="numruc"], #txtRuc, input[placeholder*="RUC" i]',
      { timeout: 25000 },
    );

    // Asegurar selección de pestaña RUC si existiese
    try {
      await page.evaluate(() => {
        const rucTab = Array.from(document.querySelectorAll('button, a, div')).find(
          (el) => el.textContent?.trim().toUpperCase() === 'RUC',
        );
        if (rucTab) (rucTab as HTMLElement).click();
      });
    } catch {
      // Si no es necesario cambiar de tab, continuar
    }

    // 3. Escribir credenciales
    const rucInput = await page.$(
      'input[name="numruc"], #txtRuc, input[placeholder*="RUC" i]',
    );
    const userInput = await page.$(
      'input[name="txtUsuario"], #txtUsuario, input[placeholder*="Usuario" i]',
    );
    const passInput = await page.$(
      'input[name="txtContrasena"], #txtContrasena, input[type="password"]',
    );

    if (!rucInput || !userInput || !passInput) {
      throw new Error(
        'No se encontraron los campos del formulario de Clave SOL en la página.',
      );
    }

    await rucInput.click({ clickCount: 3 });
    await rucInput.type(ruc, { delay: 40 });

    await userInput.click({ clickCount: 3 });
    await userInput.type(usuarioSol, { delay: 40 });

    await passInput.click({ clickCount: 3 });
    await passInput.type(claveSol, { delay: 40 });

    // 4. Click en el botón Entrar
    this.logger.log('Enviando credenciales...');
    const clicked = await page.evaluate(() => {
      const btn =
        document.querySelector(
          'button#btnAceptar, #btnAceptar, button[type="submit"], input[type="submit"]',
        ) ||
        Array.from(document.querySelectorAll('button')).find((b) =>
          b.textContent?.trim().toLowerCase().includes('entrar'),
        );
      if (btn) {
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => {});
    } else {
      await page.keyboard.press('Enter');
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => {});
    }

    // 5. Verificar error de credenciales
    const errorText = await page.evaluate(() => {
      const alert = document.querySelector(
        '.alert-danger, .error, #divError, .text-danger',
      );
      return alert ? (alert as HTMLElement).innerText.trim() : null;
    });

    if (
      errorText &&
      (errorText.toLowerCase().includes('inválid') ||
        errorText.toLowerCase().includes('incorrect'))
    ) {
      throw new Error(`Credenciales Clave SOL rechazadas por SUNAT: ${errorText}`);
    }

    const currentUrl = page.url();
    this.logger.log(`URL tras login: ${currentUrl}`);

    await new Promise((r) => setTimeout(r, 2000));

    // 6. Verificar modal de Términos y Condiciones
    const hasPendingTerms = await this.checkTermsAndConditions(page);
    if (hasPendingTerms) {
      this.logger.warn(
        `⚠️ Empresa ${ruc} requiere aceptación manual de Términos y Condiciones.`,
      );
      throw new SunafilTermsNotAcceptedError(
        `Términos y Condiciones de la Casilla SUNAFIL no aceptados por el titular para ${ruc}.`,
      );
    }

    // 7. Verificar modal de Registro de Contacto
    const hasPendingContact = await this.checkContactRegistration(page);
    if (hasPendingContact) {
      this.logger.warn(`⚠️ Empresa ${ruc} requiere registrar un contacto en SUNAFIL.`);
      throw new SunafilContactRegistrationRequiredError(
        `La empresa ${ruc} no cuenta con contactos registrados en la Casilla SUNAFIL.`,
      );
    }

    // 8. Cerrar modal informativo de bienvenida
    await this.closeWelcomeModal(page);

    return true;
  }

  /**
   * Detecta si está visible el modal de Términos y Condiciones de SUNAFIL.
   */
  async checkTermsAndConditions(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const text = (document.body.innerText || '').toUpperCase();
        const hasTermsText =
          text.includes('TERMINOS Y CONDICIONES') ||
          text.includes('TÉRMINOS Y CONDICIONES') ||
          text.includes('ACUERDO DE USO DE LA CASILLA ELECTRÓNICA');

        const hasNoAceptoBtn = Array.from(
          document.querySelectorAll('button, a, .btn'),
        ).some((b) => {
          const btnText = (b.textContent || '').trim().toLowerCase();
          return btnText.includes('no acepto') || btnText.includes('no aceptar');
        });

        return hasTermsText && hasNoAceptoBtn;
      });
    } catch {
      return false;
    }
  }

  /**
   * Detecta si está visible el modal de Registro de Contacto requerido.
   */
  async checkContactRegistration(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const text = (document.body.innerText || '').toLowerCase();
        const hasContactModal =
          text.includes('registro contacto') ||
          text.includes(
            'no cuenta con contactos registrados en la casilla electrónica',
          ) ||
          text.includes(
            'por lo que se solicita registrar por lo menos los datos de un contacto',
          );

        const hasGrabarContactoBtn = Array.from(
          document.querySelectorAll(
            'button, a, input[type="button"], input[type="submit"]',
          ),
        ).some((b) => {
          const btnText = (
            b.textContent ||
            (b as HTMLInputElement).value ||
            ''
          )
            .trim()
            .toLowerCase();
          return btnText.includes('grabar contacto');
        });

        return hasContactModal || hasGrabarContactoBtn;
      });
    } catch {
      return false;
    }
  }

  /**
   * Cierra el modal de bienvenida que lista el conteo de notificaciones sin revisar.
   */
  async closeWelcomeModal(page: Page): Promise<void> {
    try {
      await page.waitForSelector(
        '.modal.show, .modal-dialog, #modalNotificaciones, .modal-content, div[role="dialog"]',
        { timeout: 4000 },
      );

      const isTerms = await this.checkTermsAndConditions(page);
      if (isTerms) {
        throw new SunafilTermsNotAcceptedError(
          'Términos y Condiciones detectados en el modal.',
        );
      }

      const isContact = await this.checkContactRegistration(page);
      if (isContact) {
        throw new SunafilContactRegistrationRequiredError(
          'Registro de Contacto requerido detectado en el modal.',
        );
      }

      this.logger.log('Modal de bienvenida detectado. Procediendo a cerrarlo...');

      await page.evaluate(() => {
        const closeBtn =
          document.querySelector(
            '.modal-header .close, button.close, [data-dismiss="modal"]',
          ) ||
          Array.from(document.querySelectorAll('button, span, a')).find((el) => {
            const txt = el.textContent?.trim().toLowerCase() || '';
            return (
              txt === '×' || txt === 'x' || txt === 'cerrar' || txt === 'entendido'
            );
          });
        if (closeBtn) (closeBtn as HTMLElement).click();
      });

      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      if (
        e instanceof SunafilTermsNotAcceptedError ||
        e instanceof SunafilContactRegistrationRequiredError
      ) {
        throw e;
      }
      // Si no aparece modal en 4s, continuar normalmente
    }
  }
}
