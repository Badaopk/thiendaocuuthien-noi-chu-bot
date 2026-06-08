# Bot game nối chữ Telegram - Thiên Đạo Cửu Thiên

Bot này chạy bằng `server.js`, dùng cho group `cuuthien_group` với bot `@thiendaocuuthien_bot`.

## 1. Cài đặt nhanh

```bash
npm install
cp .env.example .env
# sửa BOT_TOKEN, ADMIN_IDS, MONGODB_URI, GROUP_ID, OPENAI_API_KEY trong .env
npm start
```

## 2. Lấy token bot

Vào Telegram, nhắn `@BotFather`:

```text
/newbot
```

Tạo bot với username: `thiendaocuuthien_bot`, sau đó copy token vào `BOT_TOKEN`.

## 3. Đưa bot vào group

Thêm `@thiendaocuuthien_bot` vào group `cuuthien_group`.

Nếu muốn người chơi nối bằng tin nhắn thường, vào `@BotFather`:

```text
/setprivacy
chọn thiendaocuuthien_bot
Disable
```

Sau đó xóa bot khỏi group và thêm lại. Nếu không tắt privacy, người chơi vẫn chơi được bằng lệnh `/noi cụm từ`.

## 4. Lấy GROUP_ID và ADMIN_IDS

Chạy bot, thêm bot vào group, rồi gõ:

```text
/layid
```

Bot sẽ trả về `chat id` và `user id`. Copy chat id vào `GROUP_ID`, copy id của bạn vào `ADMIN_IDS`.

## 5. Bật trí thông minh AI

Bot đã được nối với OpenAI API qua biến `OPENAI_API_KEY`. Khi bật AI, bot có thể:

- Dùng AI làm trọng tài phụ để chặn cụm vô nghĩa/rác.
- Gợi ý nối chữ thông minh hơn bằng `/goiy`.
- Cho người chơi hỏi bot bằng `/ai câu hỏi`.
- Kiểm tra nghĩa của cụm bằng `/kiemtra cụm từ`.

Cấu hình trong `.env`:

```env
OPENAI_API_KEY=sk-your_openai_api_key
OPENAI_MODEL=gpt-5.5
AI_ENABLED=true
AI_VALIDATE_MOVES=true
AI_HINTS_ENABLED=true
AI_FREE_CHAT_ENABLED=true
AI_COOLDOWN_SECONDS=8
AI_MIN_REJECT_CONFIDENCE=0.72
```

Nếu muốn chơi thoáng, đặt `AI_VALIDATE_MOVES=false`, khi đó AI vẫn dùng được cho `/ai`, `/goiy`, `/kiemtra` nhưng không tự chặn từ trong ván.

Không gửi API key vào group Telegram. Chỉ đặt key trong biến môi trường của Render/VPS.

## 6. Lệnh trong group

- `/luat` xem luật.
- `/taovan 45` admin tạo ván, mỗi lượt 45 giây.
- `/dangky` đăng ký chơi.
- `/danhsach` xem người chơi đã đăng ký.
- `/batdau` admin bắt đầu.
- `/noi học sinh` nối chữ bằng lệnh.
- Tin nhắn thường cũng được tính là từ nối nếu `NORMAL_TEXT_MODE=true` và privacy mode đã tắt.
- `/goiy` gợi ý nối chữ, có AI nếu đã cấu hình OpenAI.
- `/ai câu hỏi` hỏi Thiên Đạo AI trong group.
- `/kiemtra học sinh` nhờ AI xét cụm có nghĩa không.
- `/aistatus` xem bot đã kết nối AI chưa.
- `/boqua` xử lý bỏ lượt nếu người đang tới lượt đã hết giờ.
- `/ketthuc` admin kết thúc ván.
- `/huytu` admin hủy từ cuối nếu người chơi nhập từ sai/nghĩa bậy.
- `/diem` xem điểm cá nhân.
- `/bxh` xem bảng xếp hạng.
- `/resetgame` admin reset ván hiện tại.

## 7. Deploy lên Render

- Build command: `npm install`
- Start command: `npm start`
- Environment variables: copy từ `.env.example`
- Nên dùng MongoDB Atlas để dữ liệu không mất.

## 8. Ghi chú luật

Bot kiểm tra tự động:

- Cụm từ phải từ `MIN_SYLLABLES` đến `MAX_SYLLABLES` tiếng.
- Không chứa link, số, ký tự lạ.
- Không lặp từ/cụm từ đã dùng trong ván.
- Tiếng đầu của cụm mới phải khớp tiếng cuối của cụm trước, không phân biệt dấu.
- Mỗi lượt đúng +1 điểm.
- Quá giờ bị tính miss. Đủ `MAX_MISSES` sẽ bị loại.

Nếu chưa bật AI, bot không thể biết 100% mọi cụm từ tiếng Việt có nghĩa hay không, nên admin có `/huytu` để xử lý tranh chấp. Nếu đã bật AI, bot sẽ chấm tốt hơn nhưng vẫn có thể sai, admin vẫn có quyền dùng `/huytu`.
