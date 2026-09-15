const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Servir la carpeta de PDFs públicos para Meta/WhatsApp y descargas Web
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
app.use('/pdfs', express.static(publicDir));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || 'TU_TOKEN_DE_BOTFATHER_AQUI';
const MP_LINK = 'https://mpago.la/2GEgrGn';

// Variables de Entorno de WhatsApp Cloud API (Meta)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Topes de facturación de ARCA
const TOPES = {
  'A': 12009410, 'B': 17595182, 'C': 24670494, 'D': 30628651,
  'E': 36028231, 'F': 45151659, 'G': 53995798, 'H': 81924660,
  'I': 91699761, 'J': 105012519, 'K': 126610838
};

const userSessions = {};

// ==========================================
// 🛠️ MOTOR DE GENERACIÓN DE INFORMES EN PDF
// ==========================================
function generarPDFDiagnostico(data) {
  return new Promise((resolve) => {
    const fileName = `Diagnostico_ARCA_${Date.now()}.pdf`;
    const filePath = path.join(publicDir, fileName);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Encabezado
    doc.fillColor('#000000').fontSize(20).text('ARCA SIN MIEDO', { align: 'center' });
    doc.fontSize(12).text('Informe Técnico de Diagnóstico Fiscal', { align: 'center' });
    doc.moveDown(2);

    // Métricas del Usuario
    doc.fontSize(14).text(`Categoría Evaluada: Monotributo ${data.cat}`);
    doc.text(`Monto Facturado (12 meses): $${data.facturado.toLocaleString('es-AR')}`);
    doc.text(`Tope de Categoría: $${data.tope.toLocaleString('es-AR')}`);
    doc.text(`Margen Disponible: $${data.remanente.toLocaleString('es-AR')}`);
    doc.text(`Escala Consumida: ${data.pct}%`);
    doc.moveDown();

    // Diagnóstico y Estado
    doc.fontSize(16).text(`Estado de Riesgo: ${data.estadoNivel}`);
    doc.moveDown();

    // Detalle de Inconsistencias
    doc.fontSize(12).text('Análisis de Puntos Críticos:');
    doc.text(`• Desfasaje Gastos/Billeteras: ${data.gastosAltos ? 'DETECTADO' : 'SIN NOVEDAD'}`);
    doc.text('• Cruce Automático de Bancos: Pendiente de auditoría profunda');
    doc.moveDown(2);

    // Disclaimer Legal
    doc.fontSize(9).fillColor('#666666').text(
      'Este documento es un diagnóstico técnico orientativo basado en las métricas de la Ley 24.977 y no sustituye la defensa letrada ante intimaciones firmes.',
      { align: 'justify' }
    );

    doc.end();

    stream.on('finish', () => {
      resolve({ filePath, fileName });
    });
  });
}

// ==========================================
// 🤖 LÓGICA EXISTENTE DE TELEGRAM (Telegraf)
// ==========================================
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const userId = ctx.from.id;
  userSessions[userId] = { step: 'CATEGORIA' };

  return ctx.reply(
    `👋 *¡Bienvenido a la Calculadora ARCA Sin Miedo!*\n\n` +
    `Te voy a ayudar a evaluar en 2 minutos el riesgo de exclusión o recategorización automática por parte de ARCA.\n\n` +
    `📌 *Paso 1:* Seleccioná tu categoría actual de Monotributo:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Cat A', 'cat_A'), Markup.button.callback('Cat B', 'cat_B'), Markup.button.callback('Cat C', 'cat_C')],
        [Markup.button.callback('Cat D', 'cat_D'), Markup.button.callback('Cat E', 'cat_E'), Markup.button.callback('Cat F', 'cat_F')],
        [Markup.button.callback('Cat G', 'cat_G'), Markup.button.callback('Cat H', 'cat_H'), Markup.button.callback('Cat I', 'cat_I')],
        [Markup.button.callback('Cat J', 'cat_J'), Markup.button.callback('Cat K', 'cat_K')]
      ])
    }
  );
});

bot.action(/cat_(.+)/, (ctx) => {
  const userId = ctx.from.id;
  const cat = ctx.match[1];
  userSessions[userId] = userSessions[userId] || {};
  userSessions[userId].cat = cat;
  userSessions[userId].step = 'WAITING_FACT';

  return ctx.reply(
    `📊 *Paso 2:* Ingresá el monto aprox. facturado en los *últimos 12 meses* (solo números, sin puntos ni comas).\n\n` +
    `*Ejemplo:* Si facturaste 15 millones, escribí ` + "`15000000`" + `.`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId];

  if (session && session.step === 'WAITING_FACT') {
    const monto = parseFloat(ctx.message.text.replace(/[^0-9]/g, ''));
    if (isNaN(monto) || monto <= 0) {
      return ctx.reply('⚠️ Por favor ingresá un número válido sin signos ni puntos.');
    }

    session.facturado = monto;
    session.step = 'PREGUNTA_GASTOS';

    return ctx.reply(
      `💳 *Paso 3:* ¿Tus consumos con tarjeta, compras o acreditaciones en Mercado Pago/Bancos superan lo que facturaste?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Sí, gasto/recibo más de lo que facturo', 'gastos_si')],
        [Markup.button.callback('No, mis gastos e ingresos coinciden', 'gastos_no')]
      ])
    );
  }
});

bot.action(/gastos_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId] || {};
  const gastosAltos = ctx.match[1] === 'si';

  const cat = session.cat || 'H';
  const tope = TOPES[cat] || 81924660;
  const facturado = session.facturado || 0;

  const pct = Math.min(Math.round((facturado / tope) * 100), 100);
  const remanente = Math.max(tope - facturado, 0);

  const bloques = Math.round(pct / 10);
  const barra = '█'.repeat(bloques) + '░'.repeat(10 - bloques);

  let estadoNivel = '🟢 RIESGO BAJO';
  if (pct >= 85 || gastosAltos) estadoNivel = '🚨 RIESGO CRÍTICO';
  else if (pct >= 70) estadoNivel = '🟡 RIESGO MODERADO';

  const mensaje = 
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *DIAGNÓSTICO PRELIMINAR*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${estadoNivel}\n\n` +
    `⏳ *¿CUÁNTO TE FALTA PARA QUE ARCA TE EXCLUYA?*\n` +
    `• Categoría actual: *${cat}*\n` +
    `• Facturado (últimos 12 meses): *$${facturado.toLocaleString('es-AR')}*\n` +
    `• Límite tope categoría ${cat}: *$${tope.toLocaleString('es-AR')}*\n` +
    `• *Margen disponible antes de la exclusión:* *$${remanente.toLocaleString('es-AR')}*\n\n` +
    `Escala consumida: *${pct}%*\n` +
    `[${barra}] ${pct}%\n\n` +
    `⛔ *Atención:* En rangos superiores al 80% o con desfasajes en billeteras, la exclusión o recategorización por ARCA puede ocurrir en cualquier momento del año sin aviso previo.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔒 *CHECKLIST COMPLETO BLOQUEADO*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `▪ Parámetro Gastos vs Facturación ··· 🔒\n` +
    `▪ Cruce Billeteras / Bancos ·········· 🔒\n` +
    `▪ Límite de permanencia en el régimen 🔒\n` +
    `▪ Consistencia fiscal global ·········· 🔒\n\n` +
    `💰 *Obtené tu Informe Técnico & Consultoría Legal Personalizada por $25.000 ARS*\n\n`+
    `https://www.arcasinmiedo.online/`;

  // Enviar mensaje de texto
  await ctx.reply(mensaje, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('💳 Desbloquear Informe Completo ($25.000)', MP_LINK)],
      [Markup.button.callback('🔄 Volver a calcular', 'reiniciar')]
    ])
  });

  // Generar y adjuntar el PDF de Diagnóstico en Telegram
  const pdfData = { cat, facturado, tope, remanente, pct, estadoNivel, gastosAltos };
  const pdf = await generarPDFDiagnostico(pdfData);
  await ctx.replyWithDocument({ source: pdf.filePath, filename: 'Diagnostico_Tecnico_ARCA.pdf' });
});

bot.action('reiniciar', (ctx) => {
  delete userSessions[ctx.from.id];
  return ctx.reply('Hacé clic en /start para iniciar un nuevo cálculo.');
});

// ==========================================
// 📱 WEBHOOKS PARA WHATSAPP CLOUD API (Meta)
// ==========================================
app.get('/', (req, res) => res.send('Servidor ARCA Sin Miedo Activo'));

// Endpoint de Verificación para Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Endpoint de Recepción de Mensajes de WhatsApp
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;

    // Generar PDF y enviar link vía WhatsApp
    const pdf = await generarPDFDiagnostico({
      cat: 'H',
      facturado: 50000000,
      tope: 81924660,
      remanente: 31924660,
      pct: 61,
      estadoNivel: '🟡 RIESGO MODERADO',
      gastosAltos: false
    });

    const pdfUrl = `https://arcasinmiedo-1.onrender.com/pdfs/${pdf.fileName}`;

    if (WHATSAPP_TOKEN && PHONE_NUMBER_ID) {
      try {
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: 'whatsapp',
            to: from,
            type: 'document',
            document: {
              link: pdfUrl,
              filename: 'Diagnostico_Tecnico_ARCA.pdf',
              caption: 'Tu informe orientativo de riesgo fiscal en PDF.'
            }
          },
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
      } catch (err) {
        console.error('Error enviando documento por WhatsApp:', err.response?.data || err.message);
      }
    }
  }
  res.sendStatus(200);
});

// Iniciar Servidor Web Express
app.listen(PORT, () => console.log(`Servidor Web activo en puerto ${PORT}`));

// Iniciar Bot de Telegram
bot.launch();
console.log('🤖 Bot de Telegram ARCA corriendo...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
