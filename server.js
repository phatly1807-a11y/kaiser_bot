require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const express = require('express');

// ==========================================
// 1. CẤU HÌNH THÔNG TIN NGÂN HÀNG CỦA ÔNG
// ==========================================
const BANK_ID = 'MB'; // MB, VCB, BIDV, ICB...
const STK = '123456789999'; // Số tài khoản nhận tiền
const CHU_TK = 'TRAN NGUYEN PHAT'; // Tên chủ tài khoản (VIET HOA KHONG DAU)
const SO_TIEN_MOI_CA = 6000; // 6k một người mỗi ca

// ==========================================
// 2. CẤU HÌNH FIRESTORE DATABASE
// ==========================================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// Khung giờ cố định của team
const FRAMES = ['10h', '11h50', '13h', '15h', '18h', '20h', '21h50'];

// ==========================================
// 3. XỬ LÝ LỆNH /bot ĐỂ HIỆN MENU
// ==========================================
bot.command('bot', async (ctx) => {
  // Tạo các nút bấm khung giờ tự động từ danh sách FRAMES
  const buttons = FRAMES.map(time => Markup.button.callback(`⏰ Khung giờ ${time}`, `select_${time}`));
  
  // Chia hàng: Mỗi hàng 2 nút
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  await ctx.reply(
    '🎮 **HỆ THỐNG QUẢN LÝ TEAM CỦA PHÁT** 🎮\n\n👉 Anh em chọn khung giờ chuẩn bị bắn dưới đây:',
    Markup.inlineKeyboard(rows)
  );
});

// ==========================================
// 4. XỬ LÝ KHI CHỌN KHUNG GIỜ -> HIỆN NÚT TẠO QR / XÁC NHẬN
// ==========================================
FRAMES.forEach(time => {
  bot.action(`select_${time}`, async (ctx) => {
    await ctx.editMessageText(
      `⏰ Ông đã chọn khung giờ: **${time}**\n💰 Số tiền cần đóng: **${SO_TIEN_MOI_CA.toLocaleString()}đ**\n\nBấm nút bên dưới để tạo mã QR chuyển khoản hoặc Xác nhận sau khi bank:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🖼️ Tạo Mã QR Code', `qr_${time}`)],
        [Markup.button.callback('✅ Tôi Đã Bank (0/4)', `confirm_${time}`)]
      ])
    );
    await ctx.answerCbQuery();
  });
});

// ==========================================
// 5. XỬ LÝ TẠO MÃ QR CODE
// ==========================================
FRAMES.forEach(time => {
  bot.action(`qr_${time}`, async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name || 'An_danh';
    const memo = `BAN CUS ${time.toUpperCase()} ${username.toUpperCase()}`;
    const qrUrl = `https://img.vietqr.io/image/${BANK_ID}-${STK}-compact2.jpg?amount=${SO_TIEN_MOI_CA}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(CHU_TK)}`;

    await ctx.replyWithMarkdown(
      `🖼️ **MÃ QR KHUNG GIỜ ${time}**\n` +
      `👤 Thành viên: @${username}\n` +
      `💵 Số tiền: *${SO_TIEN_MOI_CA.toLocaleString()}đ*\n` +
      `📝 Nội dung: \`${memo}\``
    );
    await ctx.replyWithPhoto(qrUrl);
    await ctx.answerCbQuery();
  });
});

// ==========================================
// 6. XỬ LÝ NÚT XÁC NHẬN ĐỦ 4 NGƯỜI
// ==========================================
FRAMES.forEach(time => {
  bot.action(`confirm_${time}`, async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name || 'An_danh';
    
    // Lấy ngày hiện tại dạng YYYY-MM-DD để phân biệt các ngày khác nhau
    const today = new Date().toISOString().split('T')[0];
    const sessionKey = `${today}_${time}`;
    
    const sessionRef = db.collection('cus_sessions').doc(sessionKey);
    
    try {
      const doc = await sessionRef.get();
      let confirmedUsers = [];
      
      if (doc.exists) {
        confirmedUsers = doc.data().confirmed_users || [];
      }
      
      // Kiểm tra nếu người này đã bấm xác nhận trước đó rồi
      if (confirmedUsers.includes(username)) {
        return ctx.answerCbQuery('⚠️ Ông đã xác nhận cho ca này rồi mà!', { show_alert: true });
      }
      
      // Thêm user vào danh sách xác nhận
      confirmedUsers.push(username);
      
      await sessionRef.set({
        time_slot: time,
        date: today,
        confirmed_users: confirmedUsers,
        status: confirmedUsers.length >= 4 ? 'SUCCESS' : 'PENDING',
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Cập nhật lại số lượng người trên nút bấm
      if (confirmedUsers.length < 4) {
        await ctx.editMessageReplyMarkup(
          Markup.inlineKeyboard([
            [Markup.button.callback('🖼️ Tạo Mã QR Code', `qr_${time}`)],
            [Markup.button.callback(`✅ Tôi Đã Bank (${confirmedUsers.length}/4)`, `confirm_${time}`)]
          ]).reply_markup
        );
        
        await ctx.reply(`📢 @${username} đã bank thành công ca **${time}**! (${confirmedUsers.length}/4)`);
      } else {
        // Đã đủ 4 người
        await ctx.editMessageText(`🎉 **Khung giờ ${time} đã thu đủ tiền của 4 người!**`);
        await ctx.reply(
          `✅ **THÀNH CÔNG CA ${time}**\n` +
          `👥 Thành viên tham gia: ${confirmedUsers.map(u => `@${u}`).join(', ')}\n\n` +
          `🚀 **ĐỦ 4 NGƯỜI RỒI! BẮT ĐẦU ĐĂNG KÝ CUS THÔI ANH EM ƠI!**`
        );
      }
      
      await ctx.answerCbQuery();
    } catch (error) {
      console.error(error);
      ctx.reply('❌ Lỗi xử lý xác nhận trên hệ thống.');
    }
  });
});

// ==========================================
// 7. LƯU LỊCH SỬ ĐIỂM SỐ (GỬI ẢNH HOẶC CHAT)
// ==========================================

// Cú pháp nhắn tin lưu điểm: /diem [khung_giờ] [số_điểm] (Ví dụ: /diem 13h 450)
bot.command('diem', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) return ctx.reply('⚠️ Sai cú pháp! Vui lòng gõ: `/diem [Khung_Giờ] [Số_Điểm]`\nVí dụ: `/diem 13h 450`');
  
  const time = args[0];
  const score = args[1];
  const username = ctx.from.username || ctx.from.first_name || 'An_danh';
  
  try {
    await db.collection('cus_scores').add({
      username,
      time_slot: time,
      score: score,
      type: 'text',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    ctx.reply(`📊 Đã ghi nhận lịch sử ca **${time}**: @${username} đạt **${score} điểm**!`);
  } catch (e) {
    ctx.reply('❌ Lỗi lưu điểm.');
  }
});

// Chụp ảnh bảng điểm gửi lên nhóm kèm chú thích (caption) dạng: "13h 450" hoặc "21h50"
bot.on('photo', async (ctx) => {
  const caption = ctx.message.caption;
  if (!caption) return; // Nếu gửi ảnh bình thường không có chữ đi kèm thì bỏ qua

  const username = ctx.from.username || ctx.from.first_name || 'An_danh';
  const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id; // Lấy ảnh nét nhất

  try {
    await db.collection('cus_scores').add({
      username,
      note: caption, // Chữ anh em ghi kèm ảnh
      photo_tele_id: photoId, // Lưu id ảnh của telegram để có thể cần lấy lại sau
      type: 'photo',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    ctx.reply(`🖼️ Đã lưu lại ảnh chụp bảng điểm và ghi chú "${caption}" của @${username}!`);
  } catch (e) {
    console.error(e);
  }
});

// ==========================================
// 8. ĐỂ RENDER KHÔNG BỊ TẮT
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Bot hoạt động ổn định!'));
app.listen(process.env.PORT || 3000);
