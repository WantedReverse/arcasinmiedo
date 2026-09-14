const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot ARCA activo'));
app.listen(PORT, () => console.log(`Servidor web activo en puerto ${PORT}`));
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN || 'TU_TOKEN_DE_BOTFATHER_AQUI';
const MP_LINK = 'https://mpago.la/2GEgrGn';

const bot = new Telegraf(BOT_TOKEN);

// Topes de facturación anuales oficiales y vigentes de ARCA
const TOPES = {
  'A': 12009410,
  'B': 17595182,
  'C': 24670494,
  'D': 30628651,
  'E': 36028231,
  'F': 45151659,
  'G': 53995798,
  'H': 81924660,
  'I': 91699761,
  'J': 105012519,
  'K': 126610838
};

const userSessions = {};

// Comando /start
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

// Selección de Categoría
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

// Recepción del Monto Facturado
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

// Diagnóstico Final + Alerta Preventiva + Link MP
bot.action(/gastos_(.+)/, (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions[userId] || {};
  const gastosAltos = ctx.match[1] === 'si';
  
  const cat = session.cat || 'H';
  const tope = TOPES[cat] || 81924660;
  const facturado = session.facturado || 0;

  const pct = Math.min(Math.round((facturado / tope) * 100), 100);
  const remanente = Math.max(tope - facturado, 0);

  // Construcción de Barra de Progreso
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
    `💰 *Obtené tu Informe Técnico & Consultoría Legal Personalizada por $25.000 ARS*`;

  return ctx.reply(
    mensaje,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('💳 Desbloquear Informe Completo ($25.000)', MP_LINK)],
        [Markup.button.callback('🔄 Volver a calcular', 'reiniciar')]
      ])
    }
  );
});

// Reiniciar
bot.action('reiniciar', (ctx) => {
  delete userSessions[ctx.from.id];
  return ctx.reply('Hacé clic en /start para iniciar un nuevo cálculo.');
});

bot.launch();
console.log('🤖 Bot de ARCA corriendo...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
