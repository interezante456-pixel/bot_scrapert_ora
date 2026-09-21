/**
 * Logger minimalista con colores ANSI y timestamps.
 * Reemplaza NestJS Logger sin ninguna dependencia externa.
 */

const RESET = '\x1b[0m';
const COLORS = {
  log:   '\x1b[36m', // Cyan
  warn:  '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  debug: '\x1b[35m', // Magenta
  success: '\x1b[32m', // Green
};

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

function formatMessage(level: string, context: string, message: string): string {
  const color = COLORS[level as keyof typeof COLORS] ?? RESET;
  const lvl = level.toUpperCase().padEnd(7);
  return `${color}[${timestamp()}] [${lvl}] [${context}] ${message}${RESET}`;
}

export class Logger {
  constructor(private readonly context: string = 'ScraperEngine') {}

  log(message: string): void {
    console.log(formatMessage('log', this.context, message));
  }

  warn(message: string): void {
    console.warn(formatMessage('warn', this.context, message));
  }

  error(message: string, error?: unknown): void {
    console.error(formatMessage('error', this.context, message));
    if (error instanceof Error) {
      console.error(`${COLORS.error}  → ${error.stack ?? error.message}${RESET}`);
    } else if (error !== undefined) {
      console.error(`${COLORS.error}  → ${String(error)}${RESET}`);
    }
  }

  debug(message: string): void {
    if (process.env.DEBUG === 'true') {
      console.log(formatMessage('debug', this.context, message));
    }
  }

  success(message: string): void {
    console.log(formatMessage('success', this.context, `✅ ${message}`));
  }
}
