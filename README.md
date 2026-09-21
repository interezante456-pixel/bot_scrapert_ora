# BES Scraper Engine

Motor de scraping **independiente** para SUNAT (extracción de PDFs) y SUNAFIL (extracción de notificaciones).  
Opera como un proceso Node.js puro con **Puppeteer visible en pantalla** por defecto.

---

## 📁 Estructura

```
scraper-engine/
├── src/
│   ├── main.ts              ← CLI (commander) — punto de entrada principal
│   ├── server.ts            ← HTTP server opcional (Express)
│   ├── browser/
│   │   └── browser.service.ts   ← Lanzador de Puppeteer (headless: false por defecto)
│   ├── sunat/
│   │   ├── sunat-login.ts       ← Login SUNAT + manejo de popups
│   │   ├── sunat-buzon.ts       ← Navegación al Buzón Electrónico
│   │   ├── sunat-extractor.ts   ← Extracción de notificaciones + descarga PDFs
│   │   └── sunat-runner.ts      ← Orquestador completo
│   ├── sunafil/
│   │   ├── sunafil-auth.ts      ← Login Clave SOL SUNAFIL
│   │   ├── sunafil-navigator.ts ← Navegación entre módulos del sidebar
│   │   ├── sunafil-runner.ts    ← Orquestador completo
│   │   ├── interfaces/
│   │   └── extractors/          ← 5 extractores (Fiscalización, Cobranza, etc.)
│   └── shared/
│       ├── logger.ts            ← Logger con colores ANSI
│       ├── types.ts             ← Interfaces compartidas
│       └── utils.ts             ← cleanUtf8, sleep, retry, etc.
└── output/                  ← PDFs descargados y JSONs de resultado (gitignored)
```

---

## ⚙️ Configuración

```bash
# 1. Instalar dependencias
cd scraper-engine
npm install

# 2. Copiar y editar variables de entorno
cp .env.example .env
# Editar .env con tus preferencias
```

**Variables de entorno clave en `.env`:**

| Variable | Default | Descripción |
|---|---|---|
| `HEADLESS` | `false` | `false` = navegador visible, `true` = headless |
| `PUPPETEER_EXECUTABLE_PATH` | *(bundled)* | Ruta a Chrome/Chromium propio |
| `OUTPUT_DIR` | `./output` | Dónde guardar PDFs y resultados |
| `HTTP_PORT` | `3001` | Puerto del servidor HTTP opcional |

---

## 🚀 Uso — CLI

### SUNAT (extracción de PDFs)

```bash
# Navegador VISIBLE (por defecto)
npx ts-node src/main.ts sunat --ruc 20123456789 --usuario MOLLO --clave miClave123

# Headless (para integración automática)
npx ts-node src/main.ts sunat --ruc 20123456789 --usuario MOLLO --clave miClave123 --headless

# Sin descargar PDFs (solo listar)
npx ts-node src/main.ts sunat --ruc 20123456789 --usuario MOLLO --clave miClave123 --no-pdfs

# Compilado (producción)
npm run build
node dist/main.js sunat --ruc 20123456789 --usuario MOLLO --clave miClave123
```

### SUNAFIL (extracción de notificaciones)

```bash
# Todos los módulos
npx ts-node src/main.ts sunafil --ruc 20123456789 --usuario MOLLO --clave miClave123

# Solo módulos específicos
npx ts-node src/main.ts sunafil --ruc 20123456789 --usuario MOLLO --clave miClave123 \
  --modulos FISCALIZACION,COBRANZA

# Headless
npx ts-node src/main.ts sunafil --ruc 20123456789 --usuario MOLLO --clave miClave123 --headless
```

---

## 📤 Formato de Salida (JSON por stdout)

### SUNAT
```json
{
  "success": true,
  "ruc": "20123456789",
  "totalExtraidas": 12,
  "notificaciones": [
    {
      "fileId": "1234567890",
      "asunto": "ASUNTO: RESOLUCIÓN DE MULTA N° 012-2024",
      "fechaMensaje": "2024-03-15T14:30:00.000Z",
      "pdfPath": "/abs/path/to/output/sunat/20123456789/1234567890.pdf",
      "pdfDescargado": true
    }
  ],
  "pdfsPaths": ["/abs/path/to/output/sunat/20123456789/1234567890.pdf"],
  "durationMs": 45230
}
```

### SUNAFIL
```json
{
  "success": true,
  "ruc": "20123456789",
  "totalExtraidas": 5,
  "porModulo": {
    "fiscalizacion": 2,
    "cobranza": 1,
    "accionesPrevias": 1,
    "formalizacion": 0,
    "sst": 1
  },
  "notificaciones": [...],
  "durationMs": 38100
}
```

### Error con acción manual requerida (SUNAFIL)
```json
{
  "success": false,
  "ruc": "20123456789",
  "requiresManualAction": true,
  "requiresManualActionReason": "TERMINOS_PENDIENTES",
  "error": "Términos y Condiciones no aceptados..."
}
```

---

## 🌐 Uso — HTTP Server (integración con backend)

```bash
# Iniciar servidor HTTP en puerto 3001
npx ts-node src/server.ts

# O compilado
node dist/server.js
```

**Endpoints:**

```bash
# Health check
curl http://localhost:3001/health

# Ejecutar SUNAT
curl -X POST http://localhost:3001/sunat \
  -H "Content-Type: application/json" \
  -d '{"ruc": "20123456789", "usuarioSol": "MOLLO", "claveSol": "miClave"}'

# Ejecutar SUNAFIL
curl -X POST http://localhost:3001/sunafil \
  -H "Content-Type: application/json" \
  -d '{"ruc": "20123456789", "usuarioSol": "MOLLO", "claveSol": "miClave"}'
```

---

## 🔗 Integración con el Backend NestJS

### Opción A — Proceso hijo (recomendado)

```typescript
import { spawn } from 'child_process';
import * as path from 'path';

async function runSunatScraper(ruc: string, usuario: string, clave: string) {
  return new Promise<SunatRunResult>((resolve, reject) => {
    const proc = spawn('node', [
      path.resolve('../scraper-engine/dist/main.js'),
      'sunat',
      '--ruc', ruc,
      '--usuario', usuario,
      '--clave', clave,
      '--headless',
    ]);

    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.on('close', (code) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Salida inválida del scraper: ${stdout}`));
      }
    });
    proc.on('error', reject);
  });
}
```

### Opción B — HTTP

```typescript
const result = await axios.post('http://localhost:3001/sunafil', {
  ruc: empresa.ruc,
  usuarioSol: empresa.usuarioSol,
  claveSol: decryptedPassword,
});
```

---

## 🛠️ Scripts

```bash
npm run build        # Compilar TypeScript → dist/
npm run dev          # Ejecutar CLI directamente (ts-node)
npm run dev:server   # Ejecutar servidor HTTP directamente (ts-node)
npm run clean        # Eliminar dist/
```
