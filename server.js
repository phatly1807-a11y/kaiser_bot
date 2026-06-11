const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const express = require('express');

// 1. Tạo Web Server phụ tránh Render đi ngủ (Render bắt buộc có Port hoạt động)
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot Kaiser Phát Cày Thuê đang chạy 24/7!'));
app.listen(PORT, () => console.log(`Web Server kết nối trên port ${PORT}`));

// 2. Kết nối cơ sở dữ liệu đám mây Firestore
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 3. Khởi tạo Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Cấu hình cứng theo định dạng chuẩn của Phát
const CONFIG = {
  brandName: 'BẢNG GIẢI KAISER CỦA PHÁT CÀY THUÊ',
  slogan: 'UY TÍN TẠO NÊN THƯƠNG HIỆU 💎 💎',
  bankName: 'BIDV',
  accountNumber: '8806532434',
  accountHolder: 'TRAN NGUYEN PHAT',
  entryFee: 4,      // 4K
  profitPerSlot: 1, // Lời 1K
  tpFee: 3,         // TP 3K
  prize1st: 20,
  prize2nd: 10,
  prize3rd: 6,
  timeFrames: ['08H00', '10H00', '13H00', '15H00', '19H00']
};

const numberIcons = ['0️⃣1️⃣', '0️⃣2️⃣', '0️⃣3️⃣', '0️⃣4️⃣', '0️⃣5️⃣', '0️⃣6️⃣', '0️⃣7️⃣', '0️⃣8️⃣', '0️⃣9️⃣', '1️⃣0️⃣', '1️⃣1️⃣', '1️⃣2️⃣'];

// Lấy dữ liệu lịch hôm nay từ Firestore
async function getDailySchedule() {
  const todayStr = new Date().toISOString().split('T')[0]; // ID dạng YYYY-MM-DD
  const docRef = db.collection('kaiser_schedules').doc(todayStr);
  const doc = await docRef.get();

  if (!doc.exists) {
    const initialData = {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      schedules: {}
    };
    CONFIG.timeFrames.forEach(time => {
      initialData.schedules[time] = Array(12).fill('');
    });
    initialData.penaltyList = [
      { name: 'Binn Minh', count: 8 },
      { name: 'Văn Huy', count: 4 },
      { name: 'Trần Đại an', count: 28 },
      { name: 'Huy Hoàng', count: 2 },
      { name: 'Kỳ Nguyễn', count: 4 },
      { name: 'Ku Tin', count: 11 },
      { name: 'Minh Khôi', count: 4 },
      { name: 'Minh Quốc', count: 2 },
      { name: 'Minh Đạt', count: 1 },
      { name: 'Trần Cường', count: 3 }
    ];
    await docRef.set(initialData);
    return initialData;
  }
  return doc.data();
}

async function updateDailySchedule(data) {
  const todayStr = new Date().toISOString().split('T')[0];
  const docRef = db.collection('kaiser_schedules').doc(todayStr);
  await docRef.update(data);
}

// Bộ lọc thông minh tự động nhận diện khung giờ nhập vào
function detectTimeFrame(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  
  if (normalized.includes('8h') || normalized.includes('08h') || normalized.includes('8hsang')) {
    return '08H00';
  }
  if (normalized.includes('10h') || normalized.includes('10h00')) {
    return '10H00';
  }
  if (normalized.includes('1h') || normalized.includes('13h') || normalized.includes('1hchieu')) {
    return '13H00';
  }
  if (normalized.includes('3h') || normalized.includes('15h') || normalized.includes('3hchieu')) {
    return '15H00';
  }
  if (normalized.includes('7h') || normalized.includes('19h') || normalized.includes('7htoi')) {
    return '19H00';
  }
  return null;
}

// Hàm render văn bản trả về chuẩn mẫu mẫu bạn yêu cầu
function buildOutputText(dbData) {
  let text = `SCRIM ${CONFIG.brandName.toUpperCase()} – CUSTOM ${CONFIG.brandName.toUpperCase()} ⚡\n`;
  text += `💎 ${CONFIG.slogan.toUpperCase()}\n\n`;
  text += `━━━━━━━━━━━\n\n`;
  text += `                  ${CONFIG.entryFee}K          \n`;
  text += `           🥇 ${CONFIG.prize1st}K 💸\n`;
  text += `           🥈 ${CONFIG.prize2nd}K 💸\n`;
  text += `           🥉 ${CONFIG.prize3rd}K 💸 \n\n`;
  text += `━━━━━━━━━━━\n\n`;

  CONFIG.timeFrames.forEach(time => {
    text += `Bang A${time} ${CONFIG.entryFee}K ❤️‍🔥 TP ${CONFIG.tpFee}K\n`;
    const players = dbData.schedules[time];
    players.forEach((player, idx) => {
      const displayName = player.trim();
      text += `${numberIcons[idx]}${displayName ? displayName + '🏆' : ''}\n`;
    });
    text += `\n`;
  });

  text += `✅ HUỶ TRƯỚC 2H + PHÍ TRƯỚC 2H\n`;
  dbData.penaltyList.forEach(item => {
    text += `${item.name} ${item.count}\n`;
  });

  text += `\n━━━━━━━━━━━\n`;
  text += `💳 THÔNG TIN CHUYỂN KHOẢN:\n`;
  text += `👉 Ngân hàng: ${CONFIG.bankName}\n`;
  text += `👉 Số tài khoản: ${CONFIG.accountNumber}\n`;
  text += `👉 Chủ tài khoản: ${CONFIG.accountHolder}\n`;
  text += `👉 Nội dung CK: Tên_Nick + Ca_Đấu\n`;
  text += `⚠️ Vui lòng đóng phí trước giờ đấu 2 tiếng để giữ slot!`;

  return text;
}

// Bảng menu chính dưới dạng các nút bấm
function getMainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⏰ Ca 08H00', callback_data: 'view_08H00' },
          { text: '⏰ Ca 10H00', callback_data: 'view_10H00' }
        ],
        [
          { text: '⏰ Ca 13H00', callback_data: 'view_13H00' },
          { text: '⏰ Ca 15H00', callback_data: 'view_15H00' }
        ],
        [
          { text: '⏰ Ca 19H00', callback_data: 'view_19H00' }
        ],
        [
          { text: '📋 Copy Bảng Tổng Hợp', callback_data: 'export_text' },
          { text: '💳 Nhận Ảnh VietQR', callback_data: 'get_qr' }
        ]
      ]
    }
  };
}

// 4. LẮNG NGHE TIN NHẮN ĐỂ TỰ ĐỘNG XẾP CHỒNG SLOT
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Lệnh bắt đầu
  if (text.startsWith('/start') || text.startsWith('/menu')) {
    bot.sendMessage(chatId, `⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡\n\nBạn có thể gửi danh sách đăng ký xếp chồng lên nhau.\n\n*Ví dụ:*\n\`8h sáng\`\n\`Quang Huy\`\n\`Văn Tiến\`\n\nBot sẽ tự động chèn vào các slot còn trống và gửi lại bảng copy lập tức!`, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard()
    });
    return;
  }

  // Tách dòng phân tích dữ liệu
  const lines = text.split('\n');
  const firstLine = lines[0].trim();
  const detectedTime = detectTimeFrame(firstLine);

  if (detectedTime) {
    const statusMsg = await bot.sendMessage(chatId, `🔄 _Đang tiến hành tự động xếp chồng slot ca ${detectedTime}..._`, { parse_mode: 'Markdown' });

    // Lọc lấy danh sách tên người chơi ròng
    const newNames = lines.slice(1)
      .map(line => {
        return line
          .replace(/^[0-9️⃣\.\-\s\)\(\[\]]+/, '') // Loại bỏ số thứ tự rác (01., 02., 01️⃣)
          .replace(/🏆/g, '')                  // Loại bỏ cúp cũ
          .replace(/❤️‍🔥.*/g, '')              // Loại bỏ đuôi rác
          .trim();
      })
      .filter(line => line.length > 0 && !line.includes('Bang A') && !line.includes('❤️‍🔥'));

    if (newNames.length === 0) {
      bot.deleteMessage(chatId, statusMsg.message_id);
      bot.sendMessage(chatId, `❌ Không tìm thấy tên đăng ký hợp lệ từ dòng số 2 trở đi!`);
      return;
    }

    try {
      const dbData = await getDailySchedule();
      const currentPlayers = [...dbData.schedules[detectedTime]];
      
      let insertedCount = 0;
      let nameIndex = 0;

      // THUẬT TOÁN TỰ SẮP CHỒNG: Quét tuần tự từ slot 1 đến 12, hễ trống là nhét người mới vào tiếp nối
      for (let i = 0; i < 12; i++) {
        if ((!currentPlayers[i] || currentPlayers[i].trim() === '') && nameIndex < newNames.length) {
          currentPlayers[i] = newNames[nameIndex];
          nameIndex++;
          insertedCount++;
        }
      }

      dbData.schedules[detectedTime] = currentPlayers;
      await updateDailySchedule(dbData);

      bot.deleteMessage(chatId, statusMsg.message_id);

      const updatedOutput = buildOutputText(dbData);

      let successMessage = `✅ *Đã tự động xếp chồng ${insertedCount} người vào các ô trống ca ${detectedTime}!*`;
      if (insertedCount < newNames.length) {
        successMessage += `\n⚠️ _Ca đấu đã đầy! Còn dư ${newNames.length - insertedCount} người chưa thể xếp chỗ._`;
      }
      
      await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
      
      // Sử dụng thẻ <pre><code> của HTML để cho phép Phát chạm ngón tay vào là tự động copy trên Telegram di động
      await bot.sendMessage(chatId, `<pre><code>${updatedOutput}</code></pre>`, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard()
      });

    } catch (error) {
      console.error(error);
      bot.deleteMessage(chatId, statusMsg.message_id);
      bot.sendMessage(chatId, `❌ Lỗi kết nối Firestore: ${error.message}`);
    }
  }
});

// 5. XỬ LÝ SỰ KIỆN KHI NGƯỜI DÙNG CLICK NÚT BẤM (Callback)
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  bot.answerCallbackQuery(callbackQuery.id);

  // Xem chi tiết ca đấu
  if (action.startsWith('view_')) {
    const time = action.split('_')[1];
    const dbData = await getDailySchedule();
    const players = dbData.schedules[time];

    let responseText = `📅 *CHI TIẾT CA ĐẤU: ${time}* (${players.filter(p => p.trim() !== '').length}/12 Slot)\n\n`;
    const inline_keyboard = [];

    players.forEach((player, index) => {
      const displayName = player.trim() ? player : '(Trống - Đang chờ)';
      responseText += `${numberIcons[index]} ${player.trim() ? `*${player}* 🏆` : displayName}\n`;
      
      inline_keyboard.push([
        { 
          text: `${numberIcons[index]} ${player.trim() ? `Xóa: ${player}` : '➕ Đăng ký lẻ'}`, 
          callback_data: player.trim() ? `edit_delete_${time}_${index}` : `edit_add_${time}_${index}`
        }
      ]);
    });

    inline_keyboard.push([{ text: '🔙 Quay Lại Menu', callback_data: 'back_main' }]);

    bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  }

  // Về menu chính
  if (action === 'back_main') {
    bot.editMessageText(`⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡\n\nVui lòng chọn ca đấu để quản lý:`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard()
    });
  }

  // Xóa nhanh người chơi khỏi ca đấu
  if (action.startsWith('edit_delete_')) {
    const parts = action.split('_');
    const time = parts[2];
    const index = parseInt(parts[3]);

    const dbData = await getDailySchedule();
    const oldName = dbData.schedules[time][index];
    dbData.schedules[time][index] = ''; 
    await updateDailySchedule(dbData);

    bot.sendMessage(chatId, `🗑️ Đã xóa người chơi *${oldName}* khỏi Slot ${index + 1} ca ${time}!`, { parse_mode: 'Markdown' });
    
    setTimeout(() => {
      bot.deleteMessage(chatId, messageId);
      bot.sendMessage(chatId, `🔄 Cập nhật danh sách mới ca ${time}:`, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Xem lại danh sách ca', callback_data: `view_${time}` }]]
        }
      });
    }, 1000);
  }

  // Thêm người chơi thủ công lẻ vào vị trí chọn
  if (action.startsWith('edit_add_')) {
    const parts = action.split('_');
    const time = parts[2];
    const index = parseInt(parts[3]);

    bot.sendMessage(chatId, `✍️ Gửi tin nhắn chứa *Tên Người Chơi* cho Slot ${index + 1} ca ${time}:`);
    
    const nameListener = async (replyMsg) => {
      if (replyMsg.chat.id === chatId && replyMsg.text) {
        const newPlayerName = replyMsg.text.trim();
        const dbData = await getDailySchedule();
        dbData.schedules[time][index] = newPlayerName;
        await updateDailySchedule(dbData);

        bot.sendMessage(chatId, `✅ Đã điền *${newPlayerName}* vào Slot ${index + 1} ca ${time}!`, { parse_mode: 'Markdown' });
        bot.removeListener('message', nameListener);
      }
    };
    bot.on('message', nameListener);
  }

  // Xuất bảng copy
  if (action === 'export_text') {
    const dbData = await getDailySchedule();
    const outputText = buildOutputText(dbData);

    bot.sendMessage(chatId, `📋 *BẢNG GIẢI MỚI NHẤT (Chạm vào khung phía dưới để copy nhanh):*`);
    bot.sendMessage(chatId, `<pre><code>${outputText}</code></pre>`, {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard()
    });
  }

  // Xuất ảnh QR
  if (action === 'get_qr') {
    const encodedHolder = encodeURIComponent(CONFIG.accountHolder);
    const amountStr = CONFIG.entryFee * 1000;
    const qrUrl = `https://img.vietqr.io/image/${CONFIG.bankName}-${CONFIG.accountNumber}-compact.png?amount=${amountStr}&addInfo=GiaiKaiser&accountName=${encodedHolder}`;

    bot.sendPhoto(chatId, qrUrl, {
      caption: `💳 *THÔNG TIN THANH TOÁN:* \n• Chủ TK: *${CONFIG.accountHolder}*\n• STK: \`${CONFIG.accountNumber}\` (${CONFIG.bankName})\n• Số tiền đóng: *${CONFIG.entryFee}.000đ*`,
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard()
    });
  }
});