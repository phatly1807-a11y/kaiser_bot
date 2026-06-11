const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot Kaiser đang chạy 24/7!'));
app.listen(PORT);

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const OWNER_ID = 8635662032;
const sessions = {}; 

// ... [Phần getSystemConfig, updateSystemConfig, isAuthorized, getDailySchedule... giữ nguyên như cũ] ...
async function getSystemConfig() {
  const docRef = db.collection('kaiser_config').doc('default');
  const doc = await docRef.get();
  if (!doc.exists) { return { brandName: 'KAISER', entryFee: 4, profitPerSlot: 1, tpFee: 3, autoAdjustPrize: true, ctvList: [] }; }
  return doc.data();
}
async function updateSystemConfig(newConfig) { await db.collection('kaiser_config').doc('default').set(newConfig, { merge: true }); }
async function isAuthorized(userId) {
  if (Number(userId) === OWNER_ID) return true;
  const config = await getSystemConfig();
  return (config.ctvList || []).includes(Number(userId));
}
async function getDailySchedule() {
  const todayStr = new Date().toISOString().split('T')[0];
  const doc = await db.collection('kaiser_schedules').doc(todayStr).get();
  if (!doc.exists) { return { schedules: { '08H00': Array(12).fill(''), '10H00': Array(12).fill(''), '13H00': Array(12).fill(''), '15H00': Array(12).fill(''), '19H00': Array(12).fill('') }, penaltyList: [] }; }
  return doc.data();
}
async function updateDailySchedule(data) { await db.collection('kaiser_schedules').doc(new Date().toISOString().split('T')[0]).update(data); }

// LẮNG NGHE TIN NHẮN (Ưu tiên Session)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text) return;

  // Xử lý Session nhập số tiền (Nút bấm)
  if (sessions[chatId]) {
    const session = sessions[chatId];
    const config = await getSystemConfig();
    const value = parseInt(text);

    if (!isNaN(value)) {
      if (session.step === 'setup_waiting_entry') config.entryFee = value;
      else if (session.step === 'setup_waiting_profit') config.profitPerSlot = value;
      else if (session.step === 'setup_waiting_tp') config.tpFee = value;
      
      await updateSystemConfig(config);
      bot.sendMessage(chatId, `✅ Đã cập nhật thành công!`);
      delete sessions[chatId];
      return;
    }
  }

  // Lệnh /menu
  if (text.startsWith('/start') || text.startsWith('/menu')) {
    const config = await getSystemConfig();
    bot.sendMessage(chatId, `⚡ *MENU QUẢN LÝ KAISER*`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⏰ Ca 08H00', callback_data: 'view_08H00' }, { text: '⏰ Ca 10H00', callback_data: 'view_10H00' }],
          [{ text: '⏰ Ca 19H00', callback_data: 'view_19H00' }],
          [{ text: '⚙️ Cấu Hình Lệ Phí', callback_data: 'setup_menu' }]
        ]
      }
    });
  }
});

// XỬ LÝ NÚT BẤM (Callback Query)
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  
  if (action === 'setup_menu') {
    bot.sendMessage(chatId, `⚙️ Nhập số tiền bạn muốn đổi (VD: 5):`);
    // Quan trọng: Gán step vào session để bot biết bạn đang muốn sửa cái gì
    sessions[chatId] = { step: 'setup_waiting_entry' }; 
  }
  
  // ... [Phần xử lý các nút view_ , random_pair_ ... giữ nguyên] ...
});
