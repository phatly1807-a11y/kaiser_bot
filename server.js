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

// ID Telegram của bạn (Phát) - Người có toàn quyền quản trị cao nhất
const OWNER_ID = 8635662032;

// Trạng thái phiên làm việc (Session) của từng người dùng để nhập liệu liên tục
const sessions = {};

// Cấu hình mặc định hệ thống của Phát
const DEFAULT_CONFIG = {
  brandName: 'BẢNG GIẢI KAISER CỦA PHÁT CÀY THUÊ',
  slogan: 'UY TÍN TẠO NÊN THƯƠNG HIỆU 💎 💎',
  bankName: 'BIDV',
  accountNumber: '8806532434',
  accountHolder: 'TRAN NGUYEN PHAT',
  entryFee: 4,          // Mặc định phòng 4K
  profitPerSlot: 1,     // Lời 1K/Slot
  tpFee: 3,             // TP 3K
  autoAdjustPrize: true, // Tự động giảm giải khi thiếu người
  ctvList: []           // Danh sách chứa ID Telegram của các CTV được phép dùng bot
};

const numberIcons = ['0️⃣1️⃣', '0️⃣2️⃣', '0️⃣3️⃣', '0️⃣4️⃣', '0️⃣5️⃣', '0️⃣6️⃣', '0️⃣7️⃣', '0️⃣8️⃣', '0️⃣9️⃣', '1️⃣0️⃣', '1️⃣1️⃣', '1️⃣2️⃣'];
const timeFrames = ['08H00', '10H00', '13H00', '15H00', '19H00'];

// Hàm lấy cấu hình giải từ Firestore (nếu chưa có sẽ tạo mặc định)
async function getSystemConfig() {
  const docRef = db.collection('kaiser_config').doc('default');
  const doc = await docRef.get();
  if (!doc.exists) {
    await docRef.set(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  return doc.data();
}

// Hàm cập nhật cấu hình giải lên Firestore
async function updateSystemConfig(newConfig) {
  const docRef = db.collection('kaiser_config').doc('default');
  await docRef.set(newConfig, { merge: true });
}

// Hàm kiểm tra quyền sử dụng Bot (Chỉ cho phép Phát và các CTV đã đăng ký)
async function isAuthorized(chatId) {
  if (chatId === OWNER_ID) return true;
  const config = await getSystemConfig();
  const ctvList = config.ctvList || [];
  // So khớp cả kiểu số và kiểu chữ để tránh lỗi ép kiểu dữ liệu
  return ctvList.includes(chatId) || ctvList.includes(String(chatId));
}

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
    timeFrames.forEach(time => {
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

// Bộ lọc thông minh tự động nhận diện khung giờ nhập vào khi dán hàng loạt
function detectTimeFrame(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  if (normalized.includes('8h') || normalized.includes('08h') || normalized.includes('8hsang')) return '08H00';
  if (normalized.includes('10h') || normalized.includes('10h00')) return '10H00';
  if (normalized.includes('1h') || normalized.includes('13h') || normalized.includes('1hchieu')) return '13H00';
  if (normalized.includes('3h') || normalized.includes('15h') || normalized.includes('3hchieu')) return '15H00';
  if (normalized.includes('7h') || normalized.includes('19h') || normalized.includes('7htoi')) return '19H00';
  return null;
}

// Bộ phân tích cú pháp dấu cộng (+) cực kỳ thông minh của Phát
function parsePlusCommand(text) {
  const cleaned = text.trim();
  if (!cleaned.startsWith('+')) return null;
  
  // Bỏ dấu cộng và chữ số/khoảng trắng liền sau (ví dụ: +1 hoặc + 1 hoặc +)
  let body = cleaned.substring(1).trim();
  body = body.replace(/^\d+\s*/, '').trim(); // Bỏ số lượng ví dụ "+1 nguyen phat" -> "nguyen phat 8h"
  
  // Tìm khung giờ trong chuỗi
  const time = detectTimeFrame(body);
  if (!time) return null;
  
  // Tách lấy tên bằng cách lọc bỏ cụm từ chỉ giờ
  const timeRegex = /(08h00|08h|8h\s*sang|8h|10h00|10h|13h00|13h|1h\s*chieu|1h|15h00|15h|3h\s*chieu|3h|19h00|19h|7h\s*toi|7h)/i;
  const name = body.replace(timeRegex, '').trim();
  
  if (!name) return null;
  
  return { name, time };
}

// Tính toán giải thưởng cho từng ca dựa trên số người thực tế đăng ký
function calculatePrizes(filledCount, config) {
  const totalRevenue = filledCount * config.entryFee;
  const totalProfit = filledCount * config.profitPerSlot;
  const prizePool = totalRevenue - totalProfit;

  let prize1st = 0, prize2nd = 0, prize3rd = 0;

  if (filledCount === 0) {
    return { prize1st: 0, prize2nd: 0, prize3rd: 0, filledCount };
  } else if (filledCount <= 3) {
    prize1st = prizePool;
  } else {
    prize1st = Math.round(prizePool * 0.55);
    prize2nd = Math.round(prizePool * 0.28);
    prize3rd = Math.round(prizePool * 0.17);
    const diff = prizePool - (prize1st + prize2nd + prize3rd);
    prize1st += diff;
  }

  return { prize1st, prize2nd, prize3rd, filledCount };
}

// Hàm render văn bản trả về chuẩn mẫu của Phát (tích hợp giảm giải thông minh cho từng ca)
function buildOutputText(dbData, config) {
  // Tính giải chuẩn khi full 12 slot
  const stdPrizes = calculatePrizes(12, config);

  let text = `SCRIM ${config.brandName.toUpperCase()} – CUSTOM ${config.brandName.toUpperCase()} ⚡\n`;
  text += `💎 ${config.slogan.toUpperCase()}\n\n`;
  text += `━━━━━━━━━━━\n\n`;
  text += `                  ${config.entryFee}K          \n`;
  text += `           🥇 ${stdPrizes.prize1st}K 💸\n`;
  text += `           🥈 ${stdPrizes.prize2nd}K 💸\n`;
  text += `           🥉 ${stdPrizes.prize3rd}K 💸 \n\n`;
  text += `━━━━━━━━━━━\n\n`;

  timeFrames.forEach(time => {
    const players = dbData.schedules[time];
    const filledCount = players.filter(p => p.trim() !== '').length;
    
    // Nếu bật tính năng tự giảm giải thì tính toán riêng giải thưởng hiện tại cho ca đó
    let prizeNote = '';
    if (config.autoAdjustPrize && filledCount < 12) {
      const currentPrizes = calculatePrizes(filledCount, config);
      prizeNote = ` (Giải: 🥇${currentPrizes.prize1st}k/🥈${currentPrizes.prize2nd}k/🥉${currentPrizes.prize3rd}k)`;
    }

    text += `Bang A${time} ${config.entryFee}K ❤️‍🔥 TP ${config.tpFee}K${prizeNote}\n`;
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
  text += `👉 Ngân hàng: ${config.bankName}\n`;
  text += `👉 Số tài khoản: ${config.accountNumber}\n`;
  text += `👉 Chủ tài khoản: ${config.accountHolder}\n`;
  text += `👉 Nội dung CK: Tên_Nick + Ca_Đấu\n`;
  text += `⚠️ Vui lòng đóng phí trước giờ đấu 2 tiếng để giữ slot!`;

  return text;
}

// Bảng menu chính dưới dạng các nút bấm
function getMainMenuKeyboard(config) {
  const autoStatus = config.autoAdjustPrize ? 'BẬT ✅' : 'TẮT ❌';
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
          { text: `🔄 Tự giảm giải: ${autoStatus}`, callback_data: 'toggle_auto_prize' }
        ],
        [
          { text: '⚙️ Cấu Hình Lệ Phí / Thể Lệ', callback_data: 'setup_menu' }
        ],
        [
          { text: '📋 Copy Bảng Tổng Hợp', callback_data: 'export_text' },
          { text: '💳 Nhận Ảnh VietQR', callback_data: 'get_qr' }
        ]
      ]
    }
  };
}

// 4. LẮNG NGHE TIN NHẮN TỪ NGƯỜI DÙNG
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // HỆ THỐNG KIỂM TRA PHÂN QUYỀN (CHỈ PHÁT & CTV MỚI ĐƯỢC CHAT VỚI BOT)
  const isUserAuthorized = await isAuthorized(chatId);
  if (!isUserAuthorized) {
    bot.sendMessage(chatId, `🚫 *CẢNH BÁO BẢO MẬT:* Bạn không có quyền truy cập hệ thống của *Phát Cày Thuê*. Vui lòng liên hệ Admin để được cấp quyền sử dụng bot!`, { parse_mode: 'Markdown' });
    return;
  }

  const config = await getSystemConfig();

  // Khởi chạy hệ thống điều khiển
  if (text.startsWith('/start') || text.startsWith('/menu')) {
    // Reset session nếu có
    delete sessions[chatId];
    bot.sendMessage(chatId, `⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡\n\nChào Phát! Hệ thống xếp chồng tự động đã sẵn sàng. Bạn có thể chọn quản lý các ca đấu, cài đặt lệ phí hoặc gửi danh sách đăng ký thẳng vào đây để tự xếp chồng.`, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(config)
    });
    return;
  }

  // XỬ LÝ LẮNG NGHE NHẬP LIỆU THEO TỪNG BƯỚC (SESSION STATE)
  if (sessions[chatId]) {
    const session = sessions[chatId];

    // Trình đăng ký liên tục (Từng người một)
    if (session.step === 'flow_waiting_name') {
      const nameToAdd = text.trim();
      const time = session.time;

      try {
        const dbData = await getDailySchedule();
        const currentPlayers = [...dbData.schedules[time]];
        const nextEmptyIndex = currentPlayers.findIndex(player => player.trim() === '');

        if (nextEmptyIndex !== -1) {
          currentPlayers[nextEmptyIndex] = nameToAdd;
          dbData.schedules[time] = currentPlayers;
          await updateDailySchedule(dbData);

          // Hỏi xem Phát muốn tiếp tục thêm người không
          const keyboard = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Đăng Ký Tiếp ✅', callback_data: `flow_continue_${time}` },
                  { text: 'Không, Xuất Bảng 📋', callback_data: 'flow_stop' }
                ],
                [
                  { text: '🔙 Về Menu Chính', callback_data: 'back_main' }
                ]
              ]
            }
          };

          bot.sendMessage(chatId, `✅ Đã xếp *${nameToAdd}* vào Slot ${nextEmptyIndex + 1} ca ${time} thành công! Bạn có muốn tiếp tục đăng ký thêm người không?`, {
            parse_mode: 'Markdown',
            ...keyboard
          });
        } else {
          bot.sendMessage(chatId, `⚠️ Ca đấu ${time} đã đầy 12/12 người!`, getMainMenuKeyboard(config));
          delete sessions[chatId];
        }
      } catch (err) {
        bot.sendMessage(chatId, `❌ Lỗi khi lưu Firestore: ${err.message}`);
        delete sessions[chatId];
      }
      return;
    }

    // Thiết lập cấu hình: Sửa lệ phí
    if (session.step === 'setup_waiting_entry') {
      const fee = parseInt(text);
      if (isNaN(fee) || fee <= 0) {
        bot.sendMessage(chatId, `❌ Số tiền không hợp lệ! Vui lòng nhập lại số nguyên (Ví dụ: 8):`);
        return;
      }
      config.entryFee = fee;
      await updateSystemConfig(config);
      delete sessions[chatId];
      bot.sendMessage(chatId, `✅ Đã cập nhật Lệ Phí mới thành *${fee}K*!`, {
        reply_markup: { inline_keyboard: [[{ text: '⚙️ Quay Lại Setup', callback_data: 'setup_menu' }]] }
      });
      return;
    }

    // Thiết lập cấu hình: Sửa tiền lời phế
    if (session.step === 'setup_waiting_profit') {
      const profit = parseInt(text);
      if (isNaN(profit) || profit < 0) {
        bot.sendMessage(chatId, `❌ Số tiền không hợp lệ! Vui lòng nhập lại:`);
        return;
      }
      config.profitPerSlot = profit;
      await updateSystemConfig(config);
      delete sessions[chatId];
      bot.sendMessage(chatId, `✅ Đã cập nhật tiền lời/slot thành *${profit}K*!`, {
        reply_markup: { inline_keyboard: [[{ text: '⚙️ Quay Lại Setup', callback_data: 'setup_menu' }]] }
      });
      return;
    }

    // Thiết lập cấu hình: Sửa phí thế chân TP
    if (session.step === 'setup_waiting_tp') {
      const tp = parseInt(text);
      if (isNaN(tp) || tp < 0) {
        bot.sendMessage(chatId, `❌ Số tiền không hợp lệ! Vui lòng nhập lại:`);
        return;
      }
      config.tpFee = tp;
      await updateSystemConfig(config);
      delete sessions[chatId];
      bot.sendMessage(chatId, `✅ Đã cập nhật phí thế chân TP thành *${tp}K*!`, {
        reply_markup: { inline_keyboard: [[{ text: '⚙️ Quay Lại Setup', callback_data: 'setup_menu' }]] }
      });
      return;
    }

    // Thiết lập cấu hình: Nhập Telegram ID CTV mới muốn thêm (Chỉ có Phát mới truy cập được step này)
    if (session.step === 'setup_waiting_ctv_id') {
      const ctvId = text.trim();
      if (!/^\d+$/.test(ctvId)) {
        bot.sendMessage(chatId, `❌ ID không hợp lệ! ID Telegram bắt buộc chỉ chứa ký tự số (Ví dụ: 8635662032). Vui lòng nhập lại:`);
        return;
      }

      if (!config.ctvList) config.ctvList = [];

      if (!config.ctvList.includes(ctvId) && !config.ctvList.includes(Number(ctvId))) {
        config.ctvList.push(ctvId);
        await updateSystemConfig(config);
        bot.sendMessage(chatId, `✅ Đã thêm CTV mới có ID *${ctvId}* thành công!`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '👥 Quay Lại Quản Lý CTV', callback_data: 'setup_ctv' }]] }
        });
      } else {
        bot.sendMessage(chatId, `⚠️ ID CTV này đã được đăng ký quyền sử dụng từ trước rồi!`, {
          reply_markup: { inline_keyboard: [[{ text: '👥 Quay Lại Quản Lý CTV', callback_data: 'setup_ctv' }]] }
        });
      }
      delete sessions[chatId];
      return;
    }
  }

  // TÍNH NĂNG ĐĂNG KÝ NHANH CÚ PHÁP DẤU CỘNG (+) (VÍ DỤ: +1 nguyen phat 8h hoặc +nguyen phat 13h)
  const plusCmd = parsePlusCommand(text);
  if (plusCmd) {
    const { name, time } = plusCmd;
    const statusMsg = await bot.sendMessage(chatId, `🔄 _Đang tự động xếp chồng "${name}" vào ca ${time}..._`, { parse_mode: 'Markdown' });

    try {
      const dbData = await getDailySchedule();
      const currentPlayers = [...dbData.schedules[time]];
      const nextEmptyIndex = currentPlayers.findIndex(player => player.trim() === '');

      if (nextEmptyIndex !== -1) {
        currentPlayers[nextEmptyIndex] = name;
        dbData.schedules[time] = currentPlayers;
        await updateDailySchedule(dbData);

        // Tạo bảng tin nhắn đã cập nhật mới nhất
        const updatedOutput = buildOutputText(dbData, config);

        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, `✅ *Đã tự động xếp "${name}" vào Slot ${nextEmptyIndex + 1} ca ${time} thành công!*`, { parse_mode: 'Markdown' });
        
        // Gửi trả bảng đấu Copy nhanh bằng HTML Code Block
        await bot.sendMessage(chatId, `<pre><code>${updatedOutput}</code></pre>`, {
          parse_mode: 'HTML',
          ...getMainMenuKeyboard(config)
        });
      } else {
        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, `⚠️ Ca đấu ${time} đã đầy 12/12 slot! Không thể thêm tiếp.`, getMainMenuKeyboard(config));
      }
    } catch (err) {
      console.error(err);
      await bot.deleteMessage(chatId, statusMsg.message_id);
      await bot.sendMessage(chatId, `❌ Lỗi Firestore: ${err.message}`);
    }
    return; // Dừng xử lý tiếp
  }

  // TÍNH NĂNG XẾP CHỒNG TỰ ĐỘNG KHI DÁN TIN NHẮN (DÁN HÀNG LOẠT)
  const lines = text.split('\n');
  const firstLine = lines[0].trim();
  const detectedTime = detectTimeFrame(firstLine);

  if (detectedTime) {
    const statusMsg = await bot.sendMessage(chatId, `🔄 _Đang tiến hành tự động xếp chồng slot ca ${detectedTime}..._`, { parse_mode: 'Markdown' });

    const newNames = lines.slice(1)
      .map(line => {
        return line
          .replace(/^[0-9️⃣\.\-\s\)\(\[\]]+/, '') 
          .replace(/🏆/g, '')                  
          .replace(/❤️‍🔥.*/g, '')              
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

      const updatedOutput = buildOutputText(dbData, config);

      let successMessage = `✅ *Đã tự động xếp chồng ${insertedCount} người vào các ô trống ca ${detectedTime}!*`;
      if (insertedCount < newNames.length) {
        successMessage += `\n⚠️ _Ca đấu đã đầy! Còn dư ${newNames.length - insertedCount} người chưa thể xếp chỗ._`;
      }
      
      await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
      
      await bot.sendMessage(chatId, `<pre><code>${updatedOutput}</code></pre>`, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(config)
      });

    } catch (error) {
      console.error(error);
      bot.deleteMessage(chatId, statusMsg.message_id);
      bot.sendMessage(chatId, `❌ Lỗi kết nối Firestore: ${error.message}`);
    }
    return; // Dừng xử lý tiếp
  }

  // TỰ ĐỘNG GỬI MENU CHÍNH KHI PHÁT CHAT BẤT KỲ TIN NHẮN NÀO KHÔNG KHỚP CÚ PHÁP
  bot.sendMessage(chatId, `ℹ️ *Cú pháp của Phát chưa khớp với đăng ký kaiser.* \n\nHệ thống tự động hiển thị Menu điều khiển để Phát dễ sử dụng:`, {
    parse_mode: 'Markdown',
    ...getMainMenuKeyboard(config)
  });
});

// 5. XỬ LÝ SỰ KIỆN KHI NGƯỜI DÙNG CLICK NÚT BẤM (Callback)
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  bot.answerCallbackQuery(callbackQuery.id);

  // KIỂM TRA PHÂN QUYỀN NÚT BẤM CALLBACK (CHỈ PHÁT & CTV MỚI ĐƯỢC NHẤN NÚT TRÊN BOT)
  const isUserAuthorized = await isAuthorized(chatId);
  if (!isUserAuthorized) {
    bot.sendMessage(chatId, `🚫 Bạn không có quyền thực hiện hành động này!`);
    return;
  }

  const config = await getSystemConfig();

  // Xem chi tiết ca đấu
  if (action.startsWith('view_')) {
    const time = action.split('_')[1];
    const dbData = await getDailySchedule();
    const players = dbData.schedules[time];

    let responseText = `📅 *CHI TIẾT CA ĐẤU: ${time}* (${players.filter(p => p.trim() !== '').length}/12 Slot)\n\n`;
    
    // Nút Đăng Ký Nhanh Liên Tục
    const inline_keyboard = [
      [
        { text: '📝 Đăng Ký Nhanh Liên Tục', callback_data: `flow_start_${time}` },
        { text: '🗑️ Xóa Trống Cả Ca', callback_data: `clear_ca_confirm_${time}` }
      ]
    ];

    players.forEach((player, index) => {
      const displayName = player.trim() ? player : '(Trống)';
      responseText += `${numberIcons[index]} ${player.trim() ? `*${player}* 🏆` : displayName}\n`;
      
      // Cho phép sửa lẻ từng người
      if (index % 2 === 0) {
        const nextPlayer = players[index+1];
        const row = [
          { text: `${numberIcons[index]} ${player.trim() ? 'Sửa/Xóa' : '➕ Nhập'}`, callback_data: `edit_slot_${time}_${index}` }
        ];
        if (index + 1 < 12) {
          row.push({ text: `${numberIcons[index+1]} ${nextPlayer.trim() ? 'Sửa/Xóa' : '➕ Nhập'}`, callback_data: `edit_slot_${time}_${index+1}` });
        }
        inline_keyboard.push(row);
      }
    });

    inline_keyboard.push([{ text: '🔙 Quay Lại Menu Chính', callback_data: 'back_main' }]);

    bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  }

  // Khởi động Trình Đăng Ký Nhanh Liên Tục (Có hỏi Tiếp tục / Không)
  if (action.startsWith('flow_start_')) {
    const time = action.split('_')[2];
    sessions[chatId] = {
      step: 'flow_waiting_name',
      time: time
    };
    bot.sendMessage(chatId, `✍️ Nhập tên người chơi đăng ký đầu tiên cho ca *${time}*:`, { parse_mode: 'Markdown' });
  }

  // Tiếp tục Đăng Ký
  if (action.startsWith('flow_continue_')) {
    const time = action.split('_')[2];
    sessions[chatId] = {
      step: 'flow_waiting_name',
      time: time
    };
    bot.sendMessage(chatId, `✍️ Nhập tên người chơi tiếp theo:`);
  }

  // Dừng đăng ký & xuất ngay bảng đấu tổng hợp đã tự tính giải
  if (action === 'flow_stop') {
    delete sessions[chatId];
    const dbData = await getDailySchedule();
    const outputText = buildOutputText(dbData, config);

    await bot.sendMessage(chatId, `📋 *BẢNG GIẢI MỚI NHẤT (Chạm vào khung phía dưới để copy nhanh):*`);
    await bot.sendMessage(chatId, `<pre><code>${outputText}</code></pre>`, {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(config)
    });
  }

  // Menu cấu hình phí / TP
  if (action === 'setup_menu') {
    const autoStatus = config.autoAdjustPrize ? 'BẬT ✅' : 'TẮT ❌';
    const text = `⚙️ *CẤU HÌNH THỂ LỆ & PHÒNG GIẢI*\n\n` +
                 `• Lệ Phí Phòng: *${config.entryFee}K*\n` +
                 `• Tiền Lời của Phát: *${config.profitPerSlot}K / Slot*\n` +
                 `• Thế Chân TP: *${config.tpFee}K*\n` +
                 `• Tự giảm giải khi thiếu người: *${autoStatus}*\n\n` +
                 `Chọn giá trị bạn muốn thay đổi phía dưới:`;
    
    const inline_keyboard = [
      [
        { text: '✏️ Sửa Lệ Phí', callback_data: 'setup_edit_entry' },
        { text: '✏️ Sửa Tiền Lời', callback_data: 'setup_edit_profit' }
      ],
      [
        { text: '✏️ Sửa Phí TP', callback_data: 'setup_edit_tp' },
        { text: `🔄 Auto Giảm Giải: ${config.autoAdjustPrize ? 'Tắt' : 'Bật'}`, callback_data: 'toggle_auto_prize' }
      ]
    ];

    // Chỉ có ADMIN tối cao (Phát) mới được nhìn thấy và sử dụng nút bấm Quản lý CTV
    if (chatId === OWNER_ID) {
      inline_keyboard.push([{ text: '👥 Quản Lý CTV (Admin)', callback_data: 'setup_ctv' }]);
    }

    inline_keyboard.push([{ text: '🔙 Quay Lại Menu Chính', callback_data: 'back_main' }]);

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  }

  // TÍNH NĂNG MỚI: QUẢN LÝ CỘNG TÁC VIÊN (Chỉ cho phép OWNER_ID tức Phát)
  if (action === 'setup_ctv') {
    if (chatId !== OWNER_ID) {
      bot.sendMessage(chatId, `🚫 Bạn không có quyền truy cập khu vực quản trị CTV!`);
      return;
    }

    const ctvList = config.ctvList || [];
    let text = `👥 *DANH SÁCH CỘNG TÁC VIÊN (CTV) ĐƯỢC PHÂN QUYỀN:*\n\n`;
    
    if (ctvList.length === 0) {
      text += `_Chưa có cộng tác viên nào được thêm. Chỉ duy nhất bạn (Phát) có quyền sử dụng Bot._`;
    } else {
      ctvList.forEach((id, index) => {
        text += `${index + 1}. Telegram ID: \`${id}\`\n`;
      });
    }

    text += `\nChọn hành động quản trị phía dưới:`;

    const inline_keyboard = [
      [
        { text: '➕ Thêm CTV Mới', callback_data: 'ctv_add_prompt' },
        { text: '➖ Xóa Quyền CTV', callback_data: 'ctv_remove_list' }
      ],
      [{ text: '⚙️ Quay Lại Setup', callback_data: 'setup_menu' }]
    ];

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  }

  // Yêu cầu Phát nhập ID CTV mới
  if (action === 'ctv_add_prompt') {
    if (chatId !== OWNER_ID) return;
    sessions[chatId] = { step: 'setup_waiting_ctv_id' };
    bot.sendMessage(chatId, `✍️ Vui lòng dán/gửi *ID Telegram* của CTV bạn muốn phân quyền (Lấy từ @userinfobot hoặc @IdBot giống trong ảnh):`);
  }

  // Hiển thị danh sách CTV để bấm xóa quyền trực tiếp
  if (action === 'ctv_remove_list') {
    if (chatId !== OWNER_ID) return;

    const ctvList = config.ctvList || [];
    if (ctvList.length === 0) {
      bot.sendMessage(chatId, `⚠️ Danh sách CTV trống, không có ai để xóa!`);
      return;
    }

    let text = `🗑️ *CHỌN CTV BẠN MUỐN THU HỒI QUYỀN SỬ DỤNG BOT:*`;
    const inline_keyboard = [];

    ctvList.forEach((id) => {
      inline_keyboard.push([{ text: `❌ Thu hồi ID: ${id}`, callback_data: `ctv_do_remove_${id}` }]);
    });

    inline_keyboard.push([{ text: '🔙 Quay Lại Quản Lý CTV', callback_data: 'setup_ctv' }]);

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  }

  // Thực thi xóa CTV khỏi Firestore
  if (action.startsWith('ctv_do_remove_')) {
    if (chatId !== OWNER_ID) return;
    const targetId = action.replace('ctv_do_remove_', '');

    config.ctvList = (config.ctvList || []).filter(id => String(id) !== String(targetId));
    await updateSystemConfig(config);

    bot.sendMessage(chatId, `✅ Đã thu hồi quyền CTV thành công đối với ID *${targetId}*!`, { parse_mode: 'Markdown' });
    
    // Refresh lại menu quản lý CTV
    const ctvList = config.ctvList;
    let text = `👥 *DANH SÁCH CỘNG TÁC VIÊN (CTV) ĐƯỢC PHÂN QUYỀN:*\n\n`;
    if (ctvList.length === 0) {
      text += `_Chưa có cộng tác viên nào được thêm._`;
    } else {
      ctvList.forEach((id, index) => {
        text += `${index + 1}. Telegram ID: \`${id}\`\n`;
      });
    }
    text += `\nChọn hành động quản trị phía dưới:`;

    const inline_keyboard = [
      [
        { text: '➕ Thêm CTV Mới', callback_data: 'ctv_add_prompt' },
        { text: '➖ Xóa Quyền CTV', callback_data: 'ctv_remove_list' }
      ],
      [{ text: '⚙️ Quay Lại Setup', callback_data: 'setup_menu' }]
    ];

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  }

  // Yêu cầu nhập lệ phí mới
  if (action === 'setup_edit_entry') {
    sessions[chatId] = { step: 'setup_waiting_entry' };
    bot.sendMessage(chatId, `✍️ Nhập *LỆ PHÍ PHÒNG* mới dạng số nguyên (Ví dụ: Bạn muốn phòng 8K thì gõ số *8*):`);
  }

  // Yêu cầu nhập tiền lời
  if (action === 'setup_edit_profit') {
    sessions[chatId] = { step: 'setup_waiting_profit' };
    bot.sendMessage(chatId, `✍️ Nhập *TIỀN LỜI PHẾ CỦA PHÁT* mới (Ví dụ: gõ số *1* để lấy lời 1K/Slot):`);
  }

  // Yêu cầu nhập phí thế chân TP
  if (action === 'setup_edit_tp') {
    sessions[chatId] = { step: 'setup_waiting_tp' };
    bot.sendMessage(chatId, `✍️ Nhập mức *THẾ CHÂN TP* mới dạng số (Ví dụ: *3* hoặc *5*):`);
  }

  // Bật / tắt tính năng tự giảm giải
  if (action === 'toggle_auto_prize') {
    config.autoAdjustPrize = !config.autoAdjustPrize;
    await updateSystemConfig(config);
    showToast(bot, chatId, config.autoAdjustPrize ? "Đã bật tự động giảm giải thưởng" : "Đã tắt tự động giảm giải thưởng");
    
    // Refresh lại menu chính
    bot.editMessageText(`⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡\n\nĐã cập nhật trạng thái tự giảm giải thưởng khi thiếu slot!`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(config)
    });
  }

  // Sửa / Xóa lẻ từng Slot cụ thể
  if (action.startsWith('edit_slot_')) {
    const parts = action.split('_');
    const time = parts[2];
    const index = parseInt(parts[3]);

    const dbData = await getDailySchedule();
    const oldName = dbData.schedules[time][index];

    if (oldName.trim()) {
      // Slot đã có người -> Cho phép xóa hoặc đổi tên
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑️ Xóa Tên Khỏi Slot', callback_data: `do_delete_${time}_${index}` },
              { text: '✏️ Thay Đổi Tên', callback_data: `do_change_${time}_${index}` }
            ],
            [{ text: '🔙 Quay Lại Ca', callback_data: `view_${time}` }]
          ]
        }
      };
      bot.sendMessage(chatId, `Slot ${index + 1} ca ${time} hiện tại là *${oldName}*. Bạn muốn làm gì?`, { parse_mode: 'Markdown', ...keyboard });
    } else {
      // Slot trống -> Cho phép thêm nhanh trực tiếp
      bot.sendMessage(chatId, `✍️ Gửi tin nhắn chứa tên của người chơi cho Slot ${index + 1} ca ${time}:`);
      sessions[chatId] = { step: 'flow_waiting_name', time: time };
    }
  }

  // Thực thi xóa lẻ
  if (action.startsWith('do_delete_')) {
    const parts = action.split('_');
    const time = parts[2];
    const index = parseInt(parts[3]);

    const dbData = await getDailySchedule();
    const oldName = dbData.schedules[time][index];
    dbData.schedules[time][index] = '';
    await updateDailySchedule(dbData);

    bot.sendMessage(chatId, `🗑️ Đã xóa *${oldName}* khỏi Slot ${index + 1} ca ${time}!`);
    bot.deleteMessage(chatId, messageId);
  }

  // Thực thi sửa tên lẻ
  if (action.startsWith('do_change_')) {
    const parts = action.split('_');
    const time = parts[2];
    const index = parseInt(parts[3]);

    bot.sendMessage(chatId, `✍️ Gửi tin nhắn chứa *TÊN MỚI* để thay thế cho Slot ${index + 1} ca ${time}:`);
    sessions[chatId] = { step: 'flow_waiting_name', time: time };
    bot.deleteMessage(chatId, messageId);
  }

  // Yêu cầu xóa sạch ca đấu
  if (action.startsWith('clear_ca_confirm_')) {
    const time = action.split('_')[3];
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ CHẮC CHẮN XÓA HẾT 🗑️', callback_data: `clear_ca_execute_${time}` },
            { text: 'Hủy Bỏ ✕', callback_data: `view_${time}` }
          ]
        ]
      }
    };
    bot.editMessageText(`⚠️ *Phát có chắc chắn muốn xóa sạch hoàn toàn tất cả người chơi ca ${time} không?* Hành động này không thể hoàn tác!`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...keyboard
    });
  }

  // Thực thi xóa sạch ca đấu
  if (action.startsWith('clear_ca_execute_')) {
    const time = action.split('_')[3];
    const dbData = await getDailySchedule();
    dbData.schedules[time] = Array(12).fill('');
    await updateDailySchedule(dbData);

    bot.editMessageText(`✅ Đã xóa sạch toàn bộ danh sách ca ${time}!`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Quay Lại Ca Đấu', callback_data: `view_${time}` }]] }
    });
  }

  // Trở lại menu chính
  if (action === 'back_main') {
    delete sessions[chatId];
    bot.editMessageText(`⚡ *BẢNG GIẢI KAISER - PHÁT CÀY THUÊ* ⚡\n\nVui lòng chọn ca đấu để quản lý:`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(config)
    });
  }

  // Xuất bảng copy
  if (action === 'export_text') {
    const dbData = await getDailySchedule();
    const outputText = buildOutputText(dbData, config);

    bot.sendMessage(chatId, `📋 *BẢNG GIẢI MỚI NHẤT (Chạm vào khung phía dưới để copy nhanh):*`);
    bot.sendMessage(chatId, `<pre><code>${outputText}</code></pre>`, {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(config)
    });
  }

  // Xuất ảnh QR
  if (action === 'get_qr') {
    const encodedHolder = encodeURIComponent(config.accountHolder);
    const amountStr = config.entryFee * 1000;
    const qrUrl = `https://img.vietqr.io/image/${config.bankName}-${config.accountNumber}-compact.png?amount=${amountStr}&addInfo=GiaiKaiser&accountName=${encodedHolder}`;

    bot.sendPhoto(chatId, qrUrl, {
      caption: `💳 *THÔNG TIN THANH TOÁN:* \n• Chủ TK: *${config.accountHolder}*\n• STK: \`${config.accountNumber}\` (${config.bankName})\n• Số tiền đóng: *${config.entryFee}.000đ*`,
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(config)
    });
  }
});

// Hàm gửi tin nhắn thông báo nhanh dạng alert telegram
function showToast(bot, chatId, text) {
  bot.sendMessage(chatId, `ℹ️ _${text}_`, { parse_mode: 'Markdown' });
}
