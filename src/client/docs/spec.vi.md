# BANG! bản web — đặc tả

## Mục tiêu

Chơi BANG! cùng bạn bè trên trình duyệt: nhiều người chơi trực tuyến hoặc chơi đơn với máy, có trò chuyện bằng chữ và giọng nói, giao diện tiếng Trung phồn thể, tiếng Anh (chính tả Anh) hoặc tiếng Việt, và bàn chơi quán rượu 3D.

## Phạm vi

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| Giai đoạn 1 | Bản cơ bản: 80 lá, 16 nhân vật, 4–7 người | Xong |
| Giai đoạn 2 | Dodge City (40 lá, 15 nhân vật, 8 người), High Noon (14 sự kiện + lá kết), A Fistful of Cards (14 sự kiện + lá kết) | Xong |
| Giai đoạn 3 | Gold Rush (24 lá trang bị, 8 nhân vật, cửa hàng vàng), The Valley of Shadows (15 lá, 8 nhân vật), Wild West Show (8 nhân vật, 7 sự kiện + lá kết) | Xong |
| Giai đoạn 4 | Armed & Dangerous (cơ chế đạn, 28 lá, 8 nhân vật) | Đang chờ toàn văn lá bài |

Các bản mở rộng được chọn khi tạo ván hoặc phòng.

## Kiến trúc

- **Giao diện**: React + Vite; bàn 3D dùng three.js (@react-three/fiber).
- **Bộ luật**: hàm TypeScript thuần, dùng chung cho trình duyệt và máy chủ. `applyAction(trạng thái, ghế, hành động)` trả về trạng thái mới; `viewFor(trạng thái, ghế)` tạo ra những gì mỗi người được thấy (ẩn bài và vai trò của người khác).
- **Máy chủ**: Cloudflare Workers + Durable Objects. Mỗi phòng là một đối tượng giữ trạng thái chính thức và gửi góc nhìn của từng người qua WebSocket; trạng thái được lưu nên máy chủ khởi động lại vẫn chơi tiếp được.
- **Thoại**: WebRTC, tín hiệu được chuyển qua máy chủ phòng.
- **Máy (AI)**: chỉ thấy góc nhìn của mình (không gian lận). Bộ luật ghi mọi tương tác công khai có mục tiêu trong `src/engine/reputation.ts` (trọng số xem phần "Máy đoán vai trò như thế nào" trong Cách chơi). `src/ai/mind.ts` cho mỗi máy bắt đầu từ số lượng vai trò và dùng các tương tác làm bằng chứng để ước lượng xác suất vai trò của mọi người (gồm ai bắn ai, ai bắn tôi, đếm vai trò, và tính lại khi người chết lộ vai trò). Sau đó đổi thành mức chắc chắn ai là kẻ thù, chỉ bắn khi vượt ngưỡng và cao hơn hẳn mức của người chưa lộ gì, cộng thêm thù dai, kết liễu và yếu tố ngẫu nhiên. Ba độ khó: Dễ (không suy luận dây chuyền, rất ngẫu nhiên, hay sơ suất), Thường và Khó (suy luận đầy đủ nhất, ít ngẫu nhiên nhất, hăng kết liễu).
- **Ba ngôn ngữ**: nhật ký, câu hỏi và thông báo lỗi do bộ luật tạo ra đều mang tiếng Trung, tiếng Anh và tiếng Việt (`bi()` trong `src/engine/i18n.ts`), mỗi người thấy ngôn ngữ mình chọn. Tên lá bài, nhân vật và sự kiện theo bản tiếng Anh chính thức; tiếng Việt giữ nguyên các tên này và dịch phần mô tả.

## Thực thi luật

- Lượt: kiểm tra Dynamite → kiểm tra Jail → rút bài → đánh bài → bỏ bài cho bằng số máu.
- Mỗi lượt một BANG! (trừ Volcanic và Willy the Kid); mỗi loại lá trên bàn một lá; một vũ khí.
- Khoảng cách = phía gần hơn (bỏ qua người chết) + Mustang/Paul Regret − Scope/Rose Doolan, tối thiểu 1.
- Có thể uống Beer khi sắp chết (vô tác dụng khi còn hai người); Sid Ketchum bỏ 2 lá để hồi máu.
- Thắng thua: khi Cảnh sát trưởng chết, nếu chỉ còn Kẻ phản bội thì Kẻ phản bội thắng, nếu không thì Tội phạm thắng; khi mọi Tội phạm và Kẻ phản bội đã chết, phe Cảnh sát trưởng thắng.
- Giết Tội phạm được rút 3 lá; Cảnh sát trưởng giết Phó cảnh sát phải bỏ toàn bộ bài trên tay và trên bàn.

## Chọn nhân vật

- Danh sách gồm nhân vật bản cơ bản và nhân vật của các bản mở rộng đã chọn.
- Mỗi lượt chọn, mọi người chưa có nhân vật cùng gửi một lựa chọn (gửi rồi thì khóa); lựa chọn hiện công khai cho mọi người.
- Khi tất cả đã chọn: lựa chọn không trùng được giao ngay; hai người trùng thì mỗi người tung 1 đồng xu, chỉ một người ngửa thì người đó được; ba người trở lên thì mỗi người tung 3 đồng, nhiều mặt ngửa nhất thì được, hòa thì tung lại (còn hai người thì tung 1 đồng).
- Ai không được thì sang lượt chọn tiếp, chỉ chọn trong các nhân vật chưa có chủ.
- Chỗ ngồi được xáo ngẫu nhiên cả khi chơi đơn lẫn trực tuyến.
- Khi ai cũng có nhân vật: máu = máu nhân vật (+1 cho Cảnh sát trưởng), bài = số máu (Big Spencer 5 lá). Mỗi người còn được một nhân vật dự phòng ngẫu nhiên không ai dùng, cho sự kiện New Identity.

## Chi tiết bản mở rộng

- **Lá xanh lá**: ghi lại lượt đặt lên bàn, không dùng được trong lượt đó; sau đó bỏ đi để dùng, trong lượt của bạn (tấn công, hồi máu, rút bài) hoặc khi bị bắn (phòng thủ). Lasso và Belle Star làm chúng mất tác dụng.
- **Lá có chi phí**: lá cần bỏ thêm được chọn khi đánh; với sự kiện Sniper, chi phí phải là một BANG! thứ hai.
- **Sự kiện**: chọn High Noon hoặc A Fistful of Cards sẽ tạo chồng sự kiện (chọn cả hai thì trộn lấy 14 lá) với lá kết ở dưới cùng. Từ lượt thứ hai của Cảnh sát trưởng, mỗi đầu lượt của Cảnh sát trưởng lật một lá. Sự kiện có tác dụng khi lật (The Doctor, The Daltons, Russian Roulette) được xử lý ngay; các sự kiện khác kéo dài đến lá tiếp theo.
- **Ghost Town**: người chết trở lại dưới dạng hồn ma trong lượt của họ, không bị thương, không tính thắng thua, rời bàn khi hết lượt.
- **Dead Man**: người chết đầu tiên trở lại trong lượt của họ với 2 máu và 2 lá (chỉ một lần).

### Ghi chú giai đoạn 3

- **Gold Rush**: mỗi điểm sát thương gây ra được 1 vàng; ba lá cửa hàng ngửa, mua lá nào bổ sung lá đó; món viền nâu dùng ngay rồi về đáy chồng trang bị; món viền đen ở lại trước mặt, mỗi loại một món; trả "giá + 1" để bỏ món của người khác.
- **The Valley of Shadows**: Ghost đưa người chết trở lại (không bị thương, không hồi máu) cho đến khi lá bị lấy đi; Lemat cho phép lá nào cũng làm BANG!; Bounty và Shotgun xử lý khi gây sát thương.
- **Wild West Show**: khi lá kết có hiệu lực, ván chỉ kết thúc khi còn một người và thưởng phạt khi giết không còn áp dụng.
- **Chưa có**: Saved! của The Valley of Shadows (cần ngắt ngay khi bất kỳ ai bị thương), và Gag (cấm nói), Dorothy Rage (ép người khác đánh bài), Lady Rose of Texas (đổi chỗ ngồi) của Wild West Show.

## Nhân vật (bản cơ bản)

| Nhân vật | Máu | Năng lực |
|---|---|---|
| Bart Cassidy | 4 | Mỗi máu mất được rút 1 lá |
| Black Jack | 4 | Lật lá thứ hai khi rút; màu đỏ thì rút thêm 1 lá |
| Calamity Janet | 4 | BANG! và Missed! dùng thay cho nhau |
| El Gringo | 3 | Mỗi sát thương lấy 1 lá trên tay kẻ tấn công |
| Jesse Jones | 4 | Có thể rút lá đầu từ tay người khác |
| Jourdonnais | 4 | Luôn có hiệu ứng Barrel |
| Kit Carlson | 4 | Xem 3 lá, giữ 2 |
| Lucky Duke | 4 | Mỗi lần rút phán định lật 2 lá và chọn một |
| Paul Regret | 3 | Người khác nhìn anh xa thêm 1 |
| Pedro Ramirez | 4 | Có thể lấy lá đầu từ chồng bài bỏ |
| Rose Doolan | 4 | Cô nhìn người khác gần hơn 1 |
| Sid Ketchum | 4 | Bỏ 2 lá để hồi 1 máu |
| Slab the Killer | 4 | BANG! của anh cần 2 Missed! |
| Suzy Lafayette | 4 | Hết bài trên tay thì rút 1 lá |
| Vulture Sam | 4 | Lấy toàn bộ bài của người vừa chết |
| Willy the Kid | 4 | Không giới hạn BANG! |

## Nhân vật (Dodge City)

| Nhân vật | Máu | Năng lực |
|---|---|---|
| Pixie Pete | 3 | Rút 3 lá |
| Tequila Joe | 4 | Beer hồi 2 máu |
| Greg Digger | 4 | Hồi 2 máu khi có người chết |
| Herb Hunter | 4 | Rút 2 lá khi có người chết |
| Elena Fuente | 3 | Lá nào cũng làm Missed! được |
| Bill Noface | 4 | Rút 1 lá, cộng 1 lá cho mỗi máu đã mất |
| Molly Stark | 4 | Đánh bài ngoài lượt thì rút 1 lá |
| Apache Kid | 3 | Lá chất Rô của người khác vô tác dụng với anh (trừ Duel) |
| Sean Mallory | 3 | Giới hạn bài trên tay 10 lá |
| Belle Star | 4 | Trong lượt của cô, bài trên bàn của người khác mất tác dụng |
| Vera Custer | 3 | Đầu lượt sao chép năng lực của một người |
| Chuck Wengam | 4 | Mất 1 máu để rút 2 lá |
| Pat Brennan | 4 | Thay vì rút bài, lấy một lá trên bàn |
| José Delgado | 4 | Bỏ lá xanh dương để rút 2 lá (hai lần mỗi lượt) |
| Doc Holyday | 4 | Mỗi lượt một lần bỏ 2 lá để bắn |

## Chơi trực tuyến

- Tạo phòng sẽ có mã mời 5 ký tự; đường dẫn có `?room=MÃ` sẽ vào thẳng phòng.
- Chỗ ngồi được xáo khi bắt đầu (người và máy xen kẽ); chủ phòng chọn độ khó của máy. Tên của máy theo ngôn ngữ của chủ phòng lúc bắt đầu.
- Người mất kết nối được máy chơi thay sau 15 giây và lấy lại quyền khi quay về; ván tạm dừng khi mọi người đều ngoại tuyến, phòng không dùng trong 7 ngày bị xóa.
- Giới hạn thời gian mỗi quyết định: 60 giây chọn nhân vật, 90 giây đánh bài, 30 giây trả lời; hết giờ thì máy quyết định.

## Kết quả

- Màn hình kết quả cho phép đọc nhật ký cả ván (từ lúc chọn nhân vật đến khi kết thúc), hoặc đóng kết quả để xem bàn chơi cuối cùng rồi mở lại sau.

## Kiểm thử

- Kiểm thử đơn vị: số lượng lá, bắn và né, giới hạn BANG!, Slab the Killer, mục tiêu Jail, Beer khi còn hai người, bảo mật góc nhìn, thời điểm lá xanh lá, lá có chi phí, lá xanh lá phòng thủ trên bàn, The Sermon, The Judge, Lasso, chồng sự kiện.
- Chọn nhân vật: tung đồng xu khi trùng, chỉ nhân vật của bản mở rộng đã chọn, +1 máu cho Cảnh sát trưởng, máu theo nhân vật.
- Ngôn ngữ: mọi lá bài, nhân vật, sự kiện đều có tiếng Anh và tiếng Việt; mọi dòng nhật ký, câu hỏi và nút trong cả ván đều có đủ ba ngôn ngữ.
- Mô phỏng máy: nhiều ván với 4–8 người, mọi tổ hợp bản mở rộng và cả ba độ khó, kiểm tra ván nào cũng kết thúc, số lá được bảo toàn, mọi sự kiện, câu hỏi và lá bài đều xuất hiện; cùng thống kê tỉ lệ mỗi vai trò bắn nhầm phe mình và tỉ lệ thắng.
