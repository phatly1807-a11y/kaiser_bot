const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const express = require('express');

// Web Server giữ Render luôn chạy
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot Kaiser Phát Cày Thuê đang chạy trong nhóm 24/7!'));
app.listen(PORT, () => console.log(`Web Server kết nối trên port ${PORT}`));

// Kết nối Firestore
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Khởi tạo Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const OWNER_ID = 8635662032; // ID của Phát
const sessions = {}; // Quản lý session nhập liệu theo từng cuộc trò chuyện

const DEFAULT_CONFIG = {
  brandName: 'BẢNG GIẢI KAISER CỦA PHÁT CÀY THUÊ',
  slogan: 'UY TÍN TẠO NÊN THƯƠNG HIỆU 💎 💎',
  bankName: 'BIDV',
  accountNumber: '8806532434',
  accountHolder: 'TRAN NGUYEN PHAT',
  entryFee: 10,         // Chuyển mặc định sang phòng 10K cho Phát dễ dùng
  profitPerSlot: 1,     // Phế Phát lấy 1K/Slot
  tpFee: 3,             // TP mặc định 3K
  autoAdjustPrize: true,
  ctvList: []
};

const numberIcons = ['0️⃣1️⃣', '0️⃣2️⃣', '0️⃣3️⃣', '0️⃣4️⃣', '0️⃣5️⃣', '0️⃣6️⃣', '0️⃣7️⃣', '0️⃣8️⃣', '0️⃣9️⃣', '1️⃣0️⃣', '1️⃣1️⃣', '1️⃣2️⃣'];
const timeFrames = ['08H00', '10H00', '13H00', '15H00', '19H00'];

async function getSystemConfig() {
  const docRef = db.collection('kaiser_config').doc('default');
  const doc = await docRef.get();
  if (!doc.exists) { await docRef.set(DEFAULT_CONFIG); return DEFAULT_CONFIG; }
  return doc.data();
}

async function updateSystemConfig(newConfig) {
  const docRef = db.collection('kaiser_config').doc('default');
  await docRef.set(newConfig, { merge: true });
}

async function isAuthorized(userId) {
  if (userId === OWNER_ID || Number(userId) === OWNER_ID) return true;
  const config = await getSystemConfig();
  const ctvList = config.ctvList || [];
  return ctvList.includes(userId) || ctvList.includes(String(userId)) || ctvList.includes(Number(userId));
}

// Lấy dữ liệu lịch và tự động kiểm tra dọn rác mẫu cũ trên Firestore
async function getDailySchedule() {
  const todayStr = new Date().toISOString().split('T')[0];
  const docRef = db.collection('kaiser_schedules').doc(todayStr);
  const doc = await docRef.get();
  
  if (!doc.exists) {
    const initialData = { 
      createdAt: admin.firestore.FieldValue.serverTimestamp(), 
      schedules: {},
      penaltyList: [] // Khởi tạo hoàn toàn trống
    };
    timeFrames.forEach(time => { initialData.schedules[time] = Array(12).fill(''); });
    await docRef.set(initialData); 
    return initialData;
  }

  const data = doc.data();
  
  // TỰ ĐỘNG KHẮC PHỤC: Nếu Firestore đang chứa dữ liệu rác cũ (có Binn Minh), dọn sạch ngay lập tức
  if (data.penaltyList && data.penaltyList.some(item => item.name === 'Binn Minh')) {
    data.penaltyList = [];
    await docRef.update({ penaltyList: [] });
  }
  
  return data;
}

async function updateDailySchedule(data) {
  const todayStr = new Date().toISOString().split('T')[0];
  const docRef = db.collection('kaiser_schedules').doc(todayStr);
  await docRef.update(data);
}

function detectTimeFrame(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  if (normalized.includes('8h') || normalized.includes('08h') || normalized.includes('8hsang')) return '08H00';
  if (normalized.includes('10h') || normalized.includes('10h00')) return '10H00';
  if (normalized.includes('1h') || normalized.includes('13h') || normalized.includes('1hchieu')) return '13H00';
  if (normalized.includes('3h') || normalized.includes('15h') || normalized.includes('3hchieu')) return '15H00';
  if (normalized.includes('7h') || normalized.includes('19h') || normalized.includes('7htoi')) return '19H00';
  return null;
}

function parsePlusCommand(text) {
  let cleaned = text.trim();
  if (!cleaned.startsWith('+')) return null;
  let body = cleaned.substring(1).trim();
  body = body.replace(/^\d+\s*/, '').trim();
  const time = detectTimeFrame(body);
  if (!time) return null;
  const timeRegex = /(08h00|08h|8h\s*sang|8h|10h00|10h|13h00|13h|1h\s*chieu|1h|15h00|15h|3h\s*chieu|3h|19h00|19h|7h\s*toi|7h)/i;
  const name = body.replace(timeRegex, '').trim();
  if (!name) return null;
  return { name, time };
}

function calculatePrizes(filledCount, config) {
  const totalRevenue = filledCount * config.entryFee;
  const totalProfit = filledCount * config.profitPerSlot;
  const prizePool = totalRevenue - totalProfit;
  let prize1st = 0, prize2nd = 0, prize3rd = 0;
  if (filledCount === 0) return { prize1st: 0, prize2nd: 0, prize3rd: 0, filledCount };
  if (filledCount <= 3) { prize1st = prizePool; } 
  else {
    prize1st = Math.round(prizePool * 0.55); prize2nd = Math.round(prizePool * 0.28); prize3rd = Math.round(prizePool * 0.17);
    const diff = prizePool - (prize1st + prize2nd + prize3rd); prize1st += diff;
  }
  return { prize1st, prize2nd, prize3rd, filledCount };
}

function buildOutputText(dbData, config) {
  const stdPrizes = calculatePrizes(12, config);
  let text = `SCRIM ${config.brandName.toUpperCase()} – CUSTOM ${config.brandName.toUpperCase()} ⚡\n`;
  text += `💎 ${config.slogan.toUpperCase()}\n\n━━━━━━━━━━━\n\n                  ${config.entryFee}K          \n           🥇 ${stdPrizes.prize1st}K 💸\n           🥈 ${stdPrizes.prize2nd}K 💸\n           🥉 ${stdPrizes.prize3rd}K 💸 \n\n━━━━━━━━━━━\n\n`;
  timeFrames.forEach(time => {
    const players = dbData.schedules[time]; const filledCount = players.filter(p => p.trim() !== '').length;
    let prizeNote = '';
    if (config.autoAdjustPrize && filledCount < 12) {
      const currentPrizes = calculatePrizes(filledCount, config);
      prizeNote = ` (Giải: 🥇${currentPrizes.prize1st}k/🥈${currentPrizes.prize2nd}k/🥉${currentPrizes.prize3rd}k)`;
    }
    text += `Bang A${time} ${config.entryFee}K ❤️‍🔥 TP ${config.tpFee}K${prizeNote}\n`;
    players.forEach((player, idx) => { const displayName = player.trim(); text += `${numberIcons[idx]}${displayName ? displayName + '🏆' : ''}\n`; });
    text += `\n`;
  });

  const penaltyList = dbData.penaltyList || [];
  if (penaltyList.length > 0) {
    text += `✅ HUỶ TRƯỚC 2H + PHÍ TRƯỚC 2H\n`;
    penaltyList.forEach(item => {
      text += `${item.name} ${item.count}\n`;
    });
    text += `\n`;
  }

  text += `━━━━━━━━━━━\n💳 THÔNG TIN CHUYỂN KHOẢN:\n👉 Ngân hàng: ${config.bankName}\n👉 Số tài khoản: ${config.accountNumber}\n👉 Chủ tài khoản: ${config.accountHolder}\n👉 Nội dung CK: Tên_Nick + Ca_Đấu\n⚠️ Vui lòng đóng phí trước giờ đấu 2 tiếng để giữ slot!`;
  return text;
}

function getMainMenuKeyboard(config) {
  const autoStatus = config.autoAdjustPrize ? 'BẬT ✅' : 'TẮT ❌';
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⏰ Ca 08H00', callback_data: 'view_08H00' }, { text: '⏰ Ca 10H00', callback_data: 'view_10H00' }],
        [{ text: '⏰ Ca 13H00', callback_data: 'view_13H00' }, { text: '⏰ Ca 15H00', callback_data: 'view_15H00' }],
        [{ text: '⏰ Ca 19H00', callback_data: 'view_19H00' }],
        [{ text: `🔄 Tự giảm giải: ${autoStatus}`, callback_data: 'toggle_auto_prize' }],
        [{ text: '⚙️ Cấu Hình Lệ Phí / Thể Lệ', callback_data: 'setup_menu' }],
        [{ text: '📋 Copy Bảng Tổng Hợp', callback_data: 'export_text' }, { text: '💳 Nhận Ảnh VietQR', callback_data: 'get_qr' }]
      ]
    }
  };
}

// LẮNG NGHE TIN NHẮN TRONG BOX CHAT HOẶC CHAT RIÊNG
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text) return;

  const isUserAuthorized = await isAuthorized(userId);
  if (!isUserAuthorized) return; 

  const config = await getSystemConfig();

  // XỬ LÝ NHẬP LIỆU THEO TỪNG BƯỚC
  if (sessions[chatId]) {
    const session = sessions[chatId];
    const value = parseInt(text.trim());

    if (!isNaN(value) && value >= 0) {
      if (session.step === 'setup_waiting_entry') {
        config.entryFee = value;
        await updateSystemConfig(config);
        delete sessions[chatId];
        bot.sendMessage(chatId, `✅ Đã sửa lệ phí thành công thành *${value}K*!`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⚙️ Setup', callback_data: 'setup_menu' }]] }
        });
        return;
      }

      if (session.step === 'setup_waiting_profit') {
        config.profitPerSlot = value;
        await updateSystemConfig(config);
        delete sessions[chatId];
        bot.sendMessage(chatId, `✅ Đã sửa tiền lời thành công thành *${value}K*!`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⚙️ Setup', callback_data: 'setup_menu' }]] }
        });
        return;
      }

      if (session.step === 'setup_waiting_tp') {
        config.tpFee = value;
        await updateSystemConfig(config);
        delete sessions[chatId];
        bot.sendMessage(chatId, `✅ Đã sửa phí TP thành công thành *${value}K*!`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⚙️ Setup', callback_data: 'setup_menu' }]] }
        });
        return;
      }
    }

    if (session.step === 'flow_waiting_name') {
      const nameToAdd = text.trim(); const time = session.time;
      try {
        const dbData = await getDailySchedule(); const currentPlayers = [...dbData.schedules[time]];
        const nextEmptyIndex = currentPlayers.findIndex(player => player.trim() === '');
        if (nextEmptyIndex !== -1) {
          currentPlayers[nextEmptyIndex] = nameToAdd; dbData.schedules[time] = currentPlayers;
          await updateDailySchedule(dbData);
          const keyboard = {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Đăng Ký Tiếp ✅', callback_data: `flow_continue_${time}` }, { text: 'Không, Xuất Bảng 📋', callback_data: 'flow_stop' }],
                [{ text: '🔙 Về Menu Chính', callback_data: 'back_main' }]
              ]
            }
          };
          bot.sendMessage(chatId, `✅ Đã xếp *${nameToAdd}* vào Slot ${nextEmptyIndex + 1} ca ${time}!`, { parse_mode: 'Markdown', ...keyboard });
        } else {
          bot.sendMessage(chatId, `⚠️ Ca đấu ${time} đã đầy!`, getMainMenuKeyboard(config)); delete sessions[chatId];
        }
      } catch (err) { bot.sendMessage(chatId, `❌ Lỗi Firestore: ${err.message}`); delete sessions[chatId]; }
      return;
    }

    if (session.step === 'setup_waiting_ctv_id') {
      const ctvId = text.trim(); if (!/^\d+$/.test(ctvId)) { bot.sendMessage(chatId, `❌ ID sai định dạng số!`); return; }
      if (!config.ctvList) config.ctvList = [];
      if (!config.ctvList.includes(Number(ctvId))) {
        config.ctvList.push(Number(ctvId)); await updateSystemConfig(config);
        bot.sendMessage(chatId, `✅ Đã cấp quyền CTV cho ID *${ctvId}*!`, { reply_markup: { inline_keyboard: [[{ text: '👥 Quản Lý', callback_data: 'setup_ctv' }]] } });
      } else { bot.sendMessage(chatId, `⚠️ ID này đã có quyền rồi!`, { reply_markup: { inline_keyboard: [[{ text: '👥 Quản Lý', callback_data: 'setup_ctv' }]] } }); }
      delete sessions[chatId]; return;
    }
  }

  // Lệnh khởi động
  if (text.startsWith('/start') || text.startsWith('/menu')) {
    delete sessions[chatId];
    bot.sendMessage(chatId, `⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡\nHệ thống xếp lịch tự động đã sẵn sàng hoạt động tại Box này!`, {
      parse_mode: 'Markdown', ...getMainMenuKeyboard(config)
    });
    return;
  }

  // Đăng ký nhanh dấu cộng (+)
  const plusCmd = parsePlusCommand(text);
  if (plusCmd) {
    const { name, time } = plusCmd;
    try {
      const dbData = await getDailySchedule(); const currentPlayers = [...dbData.schedules[time]];
      const nextEmptyIndex = currentPlayers.findIndex(player => player.trim() === '');
      if (nextEmptyIndex !== -1) {
        currentPlayers[nextEmptyIndex] = name; dbData.schedules[time] = currentPlayers; await updateDailySchedule(dbData);
        const updatedOutput = buildOutputText(dbData, config);
        await bot.sendMessage(chatId, `✅ *Đã xếp "${name}" vào Slot ${nextEmptyIndex + 1} ca ${time}!*`, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, `<pre><code>${updatedOutput}</code></pre>`, { parse_mode: 'HTML', ...getMainMenuKeyboard(config) });
      } else { bot.sendMessage(chatId, `⚠️ Ca đấu ${time} đã đầy slot!`, getMainMenuKeyboard(config)); }
    } catch (err) { bot.sendMessage(chatId, `❌ Lỗi Firestore: ${err.message}`); }
    return;
  }

  // Dán đè hàng loạt danh sách
  const lines = text.split('\n'); const detectedTime = detectTimeFrame(lines[0].trim());
  if (detectedTime) {
    const newNames = lines.slice(1).map(line => line.replace(/^[0-9️⃣\.\-\s\)\(\[\]]+/, '').replace(/🏆/g, '').replace(/❤️‍🔥.*/g, '').trim()).filter(l => l.length > 0 && !l.includes('Bang A') && !l.includes('❤️‍🔥'));
    if (newNames.length === 0) return;
    try {
      const dbData = await getDailySchedule(); const currentPlayers = [...dbData.schedules[detectedTime]];
      let insertedCount = 0; let nameIndex = 0;
      for (let i = 0; i < 12; i++) {
        if ((!currentPlayers[i] || currentPlayers[i].trim() === '') && nameIndex < newNames.length) {
          currentPlayers[i] = newNames[nameIndex]; nameIndex++; insertedCount++;
        }
      }
      dbData.schedules[detectedTime] = currentPlayers; await updateDailySchedule(dbData);
      const updatedOutput = buildOutputText(dbData, config);
      await bot.sendMessage(chatId, `✅ *Đã xếp chồng ${insertedCount} người vào ca ${detectedTime}!*`, { parse_mode: 'Markdown' });
      await bot.sendMessage(chatId, `<pre><code>${updatedOutput}</code></pre>`, { parse_mode: 'HTML', ...getMainMenuKeyboard(config) });
    } catch (error) { bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`); }
    return;
  }
});

// XỬ LÝ SỰ KIỆN CALLBACK_QUERY KHI BẤM NÚT TRONG NHÓM
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data; const msg = callbackQuery.message;
  const chatId = msg.chat.id; const messageId = msg.message_id;
  const userId = callbackQuery.from.id; 

  bot.answerCallbackQuery(callbackQuery.id);

  const isUserAuthorized = await isAuthorized(userId);
  if (!isUserAuthorized) {
    bot.sendMessage(chatId, `🚫 Bạn không có quyền bấm nút điều khiển trên bot này!`); return;
  }

  const config = await getSystemConfig();

  if (action.startsWith('view_')) {
    const time = action.split('_')[1]; const dbData = await getDailySchedule(); const players = dbData.schedules[time];
    let responseText = `📅 *CHI TIẾT CA ĐẤU: ${time}* (${players.filter(p => p.trim() !== '').length}/12 Slot)\n\n`;
    
    // Tích hợp nút Xếp Cặp Ngẫu Nhiên
    const inline_keyboard = [
      [
        { text: '📝 Đăng Ký Liên Tục', callback_data: `flow_start_${time}` },
        { text: '🎲 Xếp Cặp Ngẫu Nhiên', callback_data: `random_pair_${time}` }
      ],
      [
        { text: '🗑️ Xóa Trống Cả Ca', callback_data: `clear_ca_confirm_${time}` }
      ]
    ];
    
    players.forEach((player, index) => {
      const displayName = player.trim() ? player : '(Trống)'; responseText += `${numberIcons[index]} ${player.trim() ? `*${player}* 🏆` : displayName}\n`;
      if (index % 2 === 0) {
        const nextPlayer = players[index+1]; const row = [{ text: `${numberIcons[index]} ${player.trim() ? 'Sửa' : '➕'}`, callback_data: `edit_slot_${time}_${index}` }];
        if (index + 1 < 12) row.push({ text: `${numberIcons[index+1]} ${nextPlayer.trim() ? 'Sửa' : '➕'}`, callback_data: `edit_slot_${time}_${index+1}` });
        inline_keyboard.push(row);
      }
    });
    inline_keyboard.push([{ text: '🔙 Quay Lại Menu', callback_data: 'back_main' }]);
    bot.editMessageText(responseText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
  }

  // TÍNH NĂNG TỰ ĐỘNG NHẬN DIỆN SỐ LƯỢNG TEAM (12, 6 HOẶC 3) ĐỂ CHIA ĐỐI ĐẦU NGẪU NHIÊN 
  if (action.startsWith('random_pair_')) {
    const time = action.split('_')[2];
    const dbData = await getDailySchedule();
    const players = dbData.schedules[time].filter(p => p.trim() !== '');

    if (players.length < 2) {
      bot.sendMessage(chatId, `⚠️ Ca đấu ${time} hiện tại chỉ có ${players.length} người. Cần tối thiểu 2 người để xếp đối đầu!`);
      return;
    }

    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let roundName = 'VÒNG ĐỐI ĐẦU QUYẾT ĐẤU';
    if (shuffled.length === 12) roundName = 'VÒNG 12 ĐỘI (6 CẶP ĐỐI ĐẦU)';
    else if (shuffled.length === 6) roundName = 'VÒNG 6 ĐỘI (3 CẶP ĐỐI ĐẦU)';
    else if (shuffled.length === 3) roundName = 'VÒNG CHUNG KẾT (3 ĐỘI TRANH CÚP)';

    let pairText = `⚔️ ĐỐI ĐẦU NGẪU NHIÊN - CA ${time} ⚔️\n`;
    pairText += `👑 ${config.brandName.toUpperCase()} 👑\n`;
    pairText += `🏆 GIAI ĐOẠN: ${roundName}\n`;
    pairText += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (shuffled.length === 3) {
      pairText += `🔥 Trận Đối Đầu Loại Trực Tiếp:\n`;
      pairText += `👉 ${shuffled[0]}   🆚   ${shuffled[1]}\n\n`;
      pairText += `🎁 Đội Được Vé Đặc Cách (Bye):\n`;
      pairText += `👉 ${shuffled[2]} ⭐ (Vào thẳng Trận Chung Kết)\n`;
    } else {
      let pairIndex = 1;
      for (let i = 0; i < shuffled.length; i += 2) {
        if (i + 1 < shuffled.length) {
          pairText += `🔥 Cặp ${pairIndex}:  ${shuffled[i]}   🆚   ${shuffled[i+1]}\n`;
          pairIndex++;
        } else {
          pairText += `✨ Vé Đặc Cách Chờ Đối Thủ:  ${shuffled[i]} ⭐\n`;
        }
      }
    }
    pairText += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    pairText += `👉 Các kị thủ chuẩn bị máy sẵn sàng nhé!`;

    await bot.sendMessage(chatId, `🎲 *Đã xếp cặp ngẫu nhiên thành công cho ca ${time}!* (Chạm vào khung dưới để copy nhanh):`);
    await bot.sendMessage(chatId, `<pre><code>${pairText}</code></pre>`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Quay Lại Ca Đấu', callback_data: `view_${time}` }],
          [{ text: '🔙 Quay Lại Menu Chính', callback_data: 'back_main' }]
        ]
      }
    });
  }

  if (action.startsWith('flow_start_')) {
    const time = action.split('_')[2]; sessions[chatId] = { step: 'flow_waiting_name', time: time };
    bot.sendMessage(chatId, `✍️ Nhập tên người chơi đầu tiên cho ca *${time}*:`, { parse_mode: 'Markdown' });
  }

  if (action.startsWith('flow_continue_')) {
    const time = action.split('_')[2]; sessions[chatId] = { step: 'flow_waiting_name', time: time };
    bot.sendMessage(chatId, `✍️ Nhập tên người chơi tiếp theo:`);
  }

  if (action === 'flow_stop') {
    delete sessions[chatId]; const dbData = await getDailySchedule(); const outputText = buildOutputText(dbData, config);
    bot.sendMessage(chatId, `<pre><code>${outputText}</code></pre>`, { parse_mode: 'HTML', ...getMainMenuKeyboard(config) });
  }

  if (action === 'setup_menu') {
    const autoStatus = config.autoAdjustPrize ? 'BẬT ✅' : 'TẮT ❌';
    const text = `⚙️ *CẤU HÌNH PHÒNG GIẢI*\n• Lệ Phí: *${config.entryFee}K*\n• Tiền Lời: *${config.profitPerSlot}K*\n• Phí TP: *${config.tpFee}K*\n• Tự giảm giải: *${autoStatus}*`;
    const inline_keyboard = [
      [{ text: '✏️ Lệ Phí', callback_data: 'setup_edit_entry' }, { text: '✏️ Tiền Lời', callback_data: 'setup_edit_profit' }],
      [{ text: '✏️ Phí TP', callback_data: 'setup_edit_tp' }, { text: `🔄 Auto Giảm Giải`, callback_data: 'toggle_auto_prize' }]
    ];
    if (userId === OWNER_ID) inline_keyboard.push([{ text: '👥 Quản Lý CTV (Admin)', callback_data: 'setup_ctv' }]);
    inline_keyboard.push([{ text: '🔙 Quay Lại Menu', callback_data: 'back_main' }]);
    bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
  }

  if (action === 'setup_ctv') {
    if (userId !== OWNER_ID) return;
    const ctvList = config.ctvList || [];
    let text = `👥 *DANH SÁCH CTV:*\n\n`;
    if (ctvList.length === 0) text += `_Chưa có CTV nào._`;
    else ctvList.forEach((id, index) => { text += `${index + 1}. ID: \`${id}\`\n`; });
    const inline_keyboard = [[{ text: '➕ Thêm CTV', callback_data: 'ctv_add_prompt' }, { text: '➖ Xóa CTV', callback_data: 'ctv_remove_list' }], [{ text: '⚙️ Setup', callback_data: 'setup_menu' }]];
    bot.editMessageText(text + `\nChọn hành động:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
  }

  if (action === 'ctv_add_prompt') {
    if (userId !== OWNER_ID) return; sessions[chatId] = { step: 'setup_waiting_ctv_id' };
    bot.sendMessage(chatId, `✍️ Gửi Telegram ID của CTV mới muốn cấp quyền:`);
  }

  if (action === 'ctv_remove_list') {
    if (userId !== OWNER_ID) return; const ctvList = config.ctvList || []; if (ctvList.length === 0) return;
    let text = `🗑️ *CHỌN CTV ĐỂ XÓA QUYỀN:*`; const inline_keyboard = [];
    ctvList.forEach(id => { inline_keyboard.push([{ text: `❌ Xóa ID: ${id}`, callback_data: `ctv_do_remove_${id}` }]); });
    inline_keyboard.push([{ text: '🔙 Quay Lại', callback_data: 'setup_ctv' }]);
    bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
  }

  if (action.startsWith('ctv_do_remove_')) {
    if (userId !== OWNER_ID) return; const targetId = action.replace('ctv_do_remove_', '');
    config.ctvList = (config.ctvList || []).filter(id => String(id) !== String(targetId)); await updateSystemConfig(config);
    bot.sendMessage(chatId, `✅ Đã xóa quyền CTV của ID ${targetId}!`);
  }

  if (action === 'setup_edit_entry') { sessions[chatId] = { step: 'setup_waiting_entry' }; bot.sendMessage(chatId, `✍️ Nhập LỆ PHÍ mới (số nguyên):`); }
  if (action === 'setup_edit_profit') { sessions[chatId] = { step: 'setup_waiting_profit' }; bot.sendMessage(chatId, `✍️ Nhập TIỀN LỜI mới:`); }
  if (action === 'setup_edit_tp') { sessions[chatId] = { step: 'setup_waiting_tp' }; bot.sendMessage(chatId, `✍️ Nhập phí TP mới:`); }

  if (action === 'toggle_auto_prize') {
    config.autoAdjustPrize = !config.autoAdjustPrize; await updateSystemConfig(config);
    bot.editMessageText(`⚡ Đã cập nhật trạng thái tự động giảm giải!`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenuKeyboard(config) });
  }

  if (action.startsWith('edit_slot_')) {
    const parts = action.split('_'); const time = parts[2]; const index = parseInt(parts[3]);
    const dbData = await getDailySchedule(); const oldName = dbData.schedules[time][index];
    if (oldName.trim()) {
      const keyboard = { inline_keyboard: [[{ text: '🗑️ Xóa Slot', callback_data: `do_delete_${time}_${index}` }, { text: '✏️ Đổi Tên', callback_data: `do_change_${time}_${index}` }], [{ text: '🔙 Quay Lại', callback_data: `view_${time}` }]] };
      bot.sendMessage(chatId, `Slot ${index + 1} ca ${time} hiện tại là *${oldName}*:`, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      bot.sendMessage(chatId, `✍️ Nhập tên cho Slot ${index + 1} ca ${time}:`); sessions[chatId] = { step: 'flow_waiting_name', time: time };
    }
  }

  if (action.startsWith('do_delete_')) {
    const parts = action.split('_'); const time = parts[2]; const index = parseInt(parts[3]);
    const dbData = await getDailySchedule(); dbData.schedules[time][index] = ''; await updateDailySchedule(dbData);
    bot.sendMessage(chatId, `🗑️ Đã xóa slot ${index + 1} ca ${time}!`); bot.deleteMessage(chatId, messageId);
  }

  if (action.startsWith('do_change_')) {
    const parts = action.split('_'); const time = parts[2]; const index = parseInt(parts[3]);
    bot.sendMessage(chatId, `✍️ Nhập TÊN MỚI thế chỗ Slot ${index + 1} ca ${time}:`); sessions[chatId] = { step: 'flow_waiting_name', time: time }; bot.deleteMessage(chatId, messageId);
  }

  if (action.startsWith('clear_ca_confirm_')) {
    const time = action.split('_')[3];
    const keyboard = { inline_keyboard: [[{ text: '🗑️ XÓA HẾT', callback_data: `clear_ca_execute_${time}` }, { text: 'Hủy', callback_data: `view_${time}` }]] };
    bot.editMessageText(`⚠️ *Xóa sạch toàn bộ ca ${time}?*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
  }

  if (action.startsWith('clear_ca_execute_')) {
    const time = action.split('_')[3]; const dbData = await getDailySchedule(); dbData.schedules[time] = Array(12).fill(''); await updateDailySchedule(dbData);
    bot.editMessageText(`✅ Đã xóa sạch ca ${time}!`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '🔙 Quay Lại', callback_data: `view_${time}` }]] } });
  }

  if (action === 'back_main') {
    delete sessions[chatId]; bot.editMessageText(`⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenuKeyboard(config) });
  }

  if (action === 'export_text') {
    const dbData = await getDailySchedule(); const outputText = buildOutputText(dbData, config);
    bot.sendMessage(chatId, `<pre><code>${outputText}</code></pre>`, { parse_mode: 'HTML', ...getMainMenuKeyboard(config) });
  }

  if (action === 'get_qr') {
    const amountStr = config.entryFee * 1000; const qrUrl = `https://img.vietqr.io/image/${config.bankName}-${config.accountNumber}-compact.png?amount=${amountStr}&addInfo=GiaiKaiser&accountName=${encodeURIComponent(config.accountHolder)}`;
    bot.sendPhoto(chatId, qrUrl, { caption: `💳 Số tiền đóng: *${config.entryFee}.000đ*`, parse_mode: 'Markdown', ...getMainMenuKeyboard(config) });
  }
});
