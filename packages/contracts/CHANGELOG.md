# CHANGELOG — @mambo/contracts

Mỗi thay đổi hợp đồng một dòng. Trong `/v1` chỉ được **thêm**; bỏ hoặc đổi nghĩa là
thay đổi phá vỡ — thêm trường mới, đánh dấu cái cũ `deprecated` ít nhất một bản phát hành.

## 0.24.0 — 26/10/2026 (gói Pro Đợt 3: phân tích, đối chiếu độ mủ, giá trên bản đồ, hợp đồng mùa vụ, cà phê tươi)

Migration `20261026000000_thay_tien_loi`: thêm cột cho phép NULL `products.green_ratio`, `places.prices`,
`places.prices_updated_at` (kèm CHECK); bảng sổ mới `season_contracts` (RLS theo tổ chức, trigger `touch_updated_at`,
`keep_soft_deleted`); hàm `place_price_plans()` (security definer, chỉ trả cột ngày tháng của gói). Chạy migration trước
khi deploy API.

- Đồng bộ: loại bản ghi mới `seasonContract` (V15) — `SeasonContractInsert` / `Patch` / `Record`, đứng CUỐI
  `SYNC_ENTITIES` để cursor kéo dở của app bản cũ không lệch bảng. `SyncChanges.seasonContracts` (mặc định `[]`; app cũ
  bỏ qua khoá lạ). Quyền: `partner:manage` cho cả thêm, sửa, xoá — người cân không tạo được. Hợp đồng không gắn vào
  phiếu: app tự cộng đã giao từ phiếu cùng người, cùng mặt hàng, trong khoảng ngày.
- Bản đồ (V9): `Place.prices` (`PlacePrice[]`, tối đa `PLACE_PRICES_LIMIT` = 10) và `Place.pricesUpdatedAt`.
  `PlaceInput` / `PlacePatch` thêm `prices` (gửi danh sách có giá cần `map:prices`, không có → 402 `PLAN_REQUIRED`;
  `null` / rỗng = gỡ giá, gói nào cũng được). Chủ điểm hết gói → máy chủ trả `prices: []`, `pricesUpdatedAt: null`
  cho mọi người; gia hạn là hiện lại, không phải khai lại.
- Mặt hàng và dòng phiếu (V24): thêm `greenRatio` (kg cà phê tươi ra 1 kg nhân, > 1, ≤ 20). Công thức vẫn là
  `lossPercent` với `lossPercent = (1 − 1/greenRatio) × 100` (core `lossFromGreenRatio`) — app bản cũ tính ra đúng tiền.
  Không thêm giá trị enum nào.
- Core mới: `analytics.ts` — `buildAnalytics` (V8: lời ước tính theo mặt hàng = lượng bán × (giá bán bình quân − giá mua
  bình quân), giá bình quân, kỳ trước qua `previousRange`), `buildRubberReconcile` (V21: độ vựa đo vs độ nhà máy đo,
  tiền chênh vì lệch độ, độ trung bình theo hộ). `taxReport.buildSalesLedger` (V17 — bảng kê bán ra).
- Quyền lợi mới: `map:prices` (máy chủ chặn); `analytics`, `rubber:reconcile` (chỉ chặn ở app).
- `quota_wall_shown.feature` thêm `analytics`, `map_prices`, `season`.

## 0.23.0 — 25/10/2026 (gói Pro Đợt 2: nhật ký, báo cáo theo gói, hình thức trả, thưởng giới thiệu)

Migration `20261025000000_quan_nguoi_giu_tien`: thêm cột cho phép NULL `payments.method` (CHECK `cash` | `transfer`) và
`subscriptions.referral_rewarded_at`; đổi `audit_log.created_at` về `timestamptz(3)` (cursor phân trang tính tới mili
giây). Chạy migration trước khi deploy API.

- Route mới `auditList` — `GET /v1/audit?actor=&from=&to=&cursor=&limit=`, quyền `staff:manage`, quyền lợi `audit:view`.
  Trả `{ entries: AuditEntryView[], cursor }`, mới nhất trước. `action` là chuỗi (không enum) — loại thao tác mới
  không làm app cũ vỡ. Nhật ký vẫn GHI ở mọi bậc gói.
- Nhật ký mới: `receipt.updated` (sửa ghi chú / ảnh của phiếu đã chốt — `before` / `after` là `{ note, photos }`;
  tiền, cân, giá không sửa được trên máy chủ), `plan.referral_bonus`, `branch.over_limit`.
- `reportsSummary`, `reportsMembers` thêm lỗi `PLAN_REQUIRED` (`reports:org`) — chỉ vựa / doanh nghiệp hết gói;
  nông dân xem phiếu đã kết nối như cũ.
- Lần trả (`PaymentInsert`, `PaymentRecord`): thêm `method` (`cash` | `transfer`, null = không ghi). `PaymentMethod`.
  Core: `recordPayment(..., method?)`, `cashPaidOnDay`, `needsCashReminder`, `CASH_REMINDER_THRESHOLD` (5.000.000đ /
  ngày / người — chỉ nhắc, không chặn).
- Core `taxReport`: `TAX_REPORT_DISCLAIMER` đổi thành câu tự chịu trách nhiệm (§4.2); mới `buildPurchaseLedger` (bảng kê
  thu mua dạng 02/TNDN — mỗi dòng hàng một dòng, khoản cộng / trừ một dòng, hình thức trả của phiếu) và `ledgerPaidBy`.
  Không thêm trường nhạy cảm nào vào sổ: CCCD, địa chỉ để file chừa trống.
- Quyền lợi mới: `audit:view`, `reports:org` (máy chủ chặn); `debt:statement`, `tax:docs`, `pay:qr` (chỉ chặn ở app).
- `quota_wall_shown.feature` thêm `audit`, `statement`, `reports`, `tax`, `pay`. Sự kiện mới
  `locked_feature_viewed { feature: 'zalo_oa' }`.
- Mở gói (webhook / quản trị viên): lần trả ĐẦU của tổ chức có chủ được giới thiệu → +1 tháng cho tổ chức đó và tổ
  chức có sổ đầu tiên của người mời, đúng một lần; thông báo dùng lại loại `plan.activated`. Doanh nghiệp đang dùng
  nhiều chi nhánh hơn `branchLimit` mới → vẫn mở gói, ghi `branch.over_limit`; tạo thêm vẫn `BRANCH_LIMIT`.

## 0.22.0 — 24/10/2026 (gói Pro Đợt 1b: giá theo chất lượng, mủ tạp theo DRC)

Migration `20261024000000_gia_theo_chat_luong`: chỉ **thêm cột cho phép NULL** (`products.rubber_kind`,
`pricing_rules.quality_metric`, `pricing_rules.quality_steps`) kèm CHECK. Chạy migration trước khi deploy API.

**Không thêm giá trị enum nào** vào `FormulaType`, `PricingRuleKind`: SDK kiểm phản hồi bằng schema, app bản cũ gặp
giá trị lạ thì cả lượt kéo sổ báo `CONTRACT_MISMATCH`. Chỉ thêm trường tuỳ chọn — app cũ bỏ qua khi đọc.

- Dòng phiếu (`TransactionLine`, `FrozenTransactionLine`): thêm tuỳ chọn `rubberKind` (`latex` | `cuplump`) và chỉ tiêu
  chất lượng `bulkDensity` (g/l), `moisturePercent`, `impurityPercent` (0–100), `kor`. Không tham gia công thức dòng:
  `freezeLineTotals` tính như cũ, sổ cũ ra đúng số cũ.
- Mặt hàng: thêm `rubberKind` (null = mủ nước như trước). Mủ tạp dùng cùng công thức `rubberLatex` (kg × DRC % × giá).
- Quy tắc giá: thêm `qualityMetric` (`bulkDensity` | `moisturePercent` | `impurityPercent` | `kor` | `qualityPercent`) và
  `qualitySteps` (`[{ from, amountPerUnit }]`, tối đa `PRICING_RULE_LIMITS.qualitySteps` = 20, tiền là số nguyên).
  Có `qualityMetric` thì `suggestAdjustments` cộng mỗi dòng: mốc áp (`qualityStepOf`) × lượng tính tiền của dòng,
  bỏ qua `fixedAmount` / `percentOfTotal`. Khoản sinh ra là `PriceAdjustment` như cũ (`kind` giữ của quy tắc).
- `quota_wall_shown.feature` thêm `quality`, `rubber`.
- Quyền lợi mới: `quality:pricing` (V19), `rubber:grades` (V20). Chỉ chặn ở app — quy tắc giá chạy ở máy, và hết gói
  thì `/sync/push` đã chặn bằng `PLAN_EXPIRED`.

## 0.21.0 — 24/10/2026 (gói Pro Đợt 1: bức tường theo gói ở máy chủ)

Không có migration. Quyền lợi suy từ bậc gói (`planFor`), không lưu thêm gì. **Bật ngay khi deploy**, không qua cờ
`features`. App 0.20 vẫn chạy với API 0.21 nhưng gặp 402 mới chỉ hiện câu lỗi chung ⇒ nâng app ngay sau khi tag.

- Mới: `ENTITLEMENTS`, `Entitlement`, `entitlementsFor(orgType, tier)`, `entitled(...)`, `STAFF_LIMIT` — bảng quyền lợi
  theo gói, bản duy nhất cho máy chủ, app và test. Dùng thử / đang trả / ân hạn: đủ; hết gói, chưa có gói, nông dân:
  không có gì. App tính từ `plan.tier` của `/v1/me` (đã có cho mọi thành viên) — `/v1/me` không đổi.
- Mã lỗi mới, cả hai là 402 và không thử lại:
  - `PLAN_REQUIRED` — `details.entitlement`. Hết gói mà thêm người (`orgMembersCreate`), xin URL tải ảnh
    (`attachmentsUploadUrl`), tạo chi nhánh (`orgBranchesCreate`) hoặc bỏ lưu trữ chi nhánh (`orgBranchUpdate`
    với `archived: false`). Đổi tên / lưu trữ chi nhánh, xem ảnh cũ, kéo sổ, người đang có: không chặn.
  - `MEMBER_LIMIT` — `details.limit`. Vựa có gói tối đa 3 người (không tính chủ); thêm mới hay bật lại người cũ
    đều tính. Doanh nghiệp không giới hạn số người (giới hạn theo chi nhánh như cũ).
- `RouteDef.entitlement` (tuỳ chọn) — route cần quyền lợi nào; `openapi.json` ghi `x-entitlement`.
- `quota_wall_shown.feature` thêm `members`, `attachments`.
- `/sync/push` hết gói vẫn là `PLAN_EXPIRED` như cũ.

## 0.20.2 — 23/10/2026 (biểu đồ 7 ngày có ngày/tháng)

Không đổi route, không có migration. App 0.20.0 chạy được với API 0.20.2.

- `@mambo/core`: `DailyPoint` (kết quả `dailySpend`) có thêm `date` — đầu ngày theo giờ máy, dạng ISO — để app ghi
  ngày/tháng dưới nhãn thứ. `label` và `spent` giữ nguyên.

## 0.20.1 — 23/10/2026 (cờ tính năng bật sẵn)

Không đổi hình dạng route nào. Có **migration** `20261023000000_bat_features` — chạy trên staging trước khi merge.

- `/v1/me` — `membership.features` có giá trị thật: tổ chức mới tạo qua `meBootstrap` được ghi sẵn mọi cờ
  (`orders`, `links`); migration ghi hai cờ đó cho mọi tổ chức đang có. Trước đây không chỗ nào ghi
  `organization_features` nên `features` luôn `[]`. App hiện không ẩn gì theo cờ ⇒ không phải nâng app.

Ngoài hợp đồng, cũng có trong bản này (merge sau tag 0.20.0): PR #44 — `resolve-identifier` có hay không có tài khoản đều
tốn cùng một lượt gọi Auth Admin (pentest, không dò được qua độ trễ).

## 0.20.0 — 19/10/2026 (Đợt 2: trùng tên, giới hạn ô nhập, ảnh, chi nhánh, email chưa xác nhận)

Không đổi hình dạng route nào. Có **migration** `20261020000000_email_chua_xac_nhan` — chạy trên staging trước khi merge.
App 0.19 chạy được với API 0.20 ⇒ **deploy API trước, rồi nâng app**.

- Mới: `PARTY_LIMITS`, `PRODUCT_LIMITS`, `NOTE_LIMITS` — độ dài tối đa của từng ô, đúng con số schema đồng bộ đang
  dùng (không đổi giá trị). App đặt `maxLength` theo đây để người dùng không gõ quá rồi bị máy chủ từ chối cả op.
- `@mambo/core`: `partiesNamed(parties, name)` và tham số `PartyMatch { asNew?, keepApart? }` cho `addSupplier`,
  `addBuyer`, `resolveSupplier`, `resolveBuyer`, `addTransaction`, `importSuppliers`, `importReceipts`. Mặc định giữ
  nguyên hành vi cũ (trùng tên ⇒ dùng lại người cũ); `asNew` ép tạo người mới, `keepApart` không gộp vào những hồ sơ
  đã kết nối. Không truyền gì thì như 0.19.
- `@mambo/sdk`: tải ảnh lên Storage đọc mã lỗi thật trong thân phản hồi (Storage trả HTTP 400 kèm `statusCode`):
  409 ⇒ coi như đã có (xong), 413 ⇒ `PAYLOAD_TOO_LARGE`, 415 / 400 có lý do ⇒ `VALIDATION_FAILED`, 401 / 403 / 429 ⇒
  `UNAUTHENTICATED` / `FORBIDDEN` / `RATE_LIMITED`, còn lại ⇒ `INTERNAL` (lỗi tạm, app giữ ảnh lại thử sau).
- Chi nhánh chỉ dành cho doanh nghiệp: vựa tạo / bỏ lưu trữ chi nhánh, hay gắn người vào chi nhánh ⇒ `FORBIDDEN`.
  Chi nhánh cũ của vựa (nếu có) vẫn lưu trữ, đổi tên, gỡ người ra được.
- Email khôi phục **chưa xác nhận** không giữ chỗ và không đăng nhập được: chỉ email đã bấm link mới là duy nhất và
  dùng được ở ô đăng nhập. Ai bấm link trước thì giữ; người sau nhận `VALIDATION_FAILED` với
  `details.reason = 'EMAIL_TAKEN'` (không thêm mã lỗi mới — app cũ vẫn hiểu). Sửa hồ sơ sang email người khác đã xác
  nhận ⇒ 422 như cũ. `/v1/me` lấy `user.email` từ hồ sơ (trước đây từ lúc đăng ký, sửa ở hồ sơ không đổi theo).

## 0.19.0 — 19/10/2026 (hàng đợi đồng bộ không kẹt vì cả lượt bị từ chối)

Không đổi hình dạng route nào. App 0.18 chạy được với API 0.19 ⇒ **deploy API trước, rồi nâng app**.

- Mới: `API_BODY_LIMIT_BYTES` (1MB — giới hạn thân JSON của API, `bootstrap.ts` dùng chính hằng này) và
  `SYNC_PUSH_MAX_BYTES` (700KB). `SYNC_PUSH_MAX_OPS` (200) không đủ giữ lô dưới 1MB: 200 op nháp tự lưu, mỗi op mang
  trọn các dòng hàng, đã vượt — máy chủ trả `PAYLOAD_TOO_LARGE` cho cả lượt. App cắt lô theo cả số op lẫn số byte.
- `@mambo/core`: `SyncStatus.refused?` — máy chủ từ chối cả lượt đẩy vì lý do không phải mạng (`NOT_A_MEMBER`,
  vỏ request sai…). App giữ nguyên hàng đợi, không gắn cờ kẹt op nào, và không báo là "mất mạng".

## 0.18.0 — 19/10/2026 (rà soát đồng bộ, đơn, thanh toán)

Không đổi hình dạng route nào. App 0.17 chạy được với API 0.18 ⇒ **deploy API trước, rồi nâng app**.

- `RECEIPT_LIMITS` — giới hạn của phiếu / nháp mà schema đồng bộ đang dùng (100 dòng, 20 khoản cộng/trừ, 10 ảnh,
  % 0–100, số cân / đơn giá ≤ 1 tỷ, nhãn khoản 120, tên người bán 200, ghi chú 2000 ký tự). App chặn ở ô nhập bằng
  đúng các hằng này: để lọt lên thì op bị `VALIDATION_FAILED` và chặn cả hàng đợi.
- `/sync/push` — từ chối vì chi nhánh (`FORBIDDEN`) mang `details.reason: 'BRANCH_SCOPE'`: người gắn chi nhánh đụng
  phiếu của chi nhánh khác, gặp khi chủ vừa đổi chi nhánh của người đó mà máy còn thao tác chưa gửi. Op đó không
  bao giờ gửi được nữa.
- `/sync/push` — chờ khoá của tổ chức quá lâu (nhiều máy cùng đẩy) → `RATE_LIMITED` (thử lại được), trước đây là
  `INTERNAL`.
- `/sync/push` — nháp: đổi `kind` mà giữ `orderId` cũng xét lại đúng bên; nháp gắn đơn đã huỷ → gỡ `orderId`,
  `ORDER_NOT_OPEN` (như phiếu). Trigger `book_order_guard` chạy cả khi đổi `kind`.
- Đơn của người gắn chi nhánh (`ordersList`, `orderGet`, chuyển trạng thái, phiếu theo đơn): thấy đơn chi nhánh mình
  tạo **và mọi đơn bên kia gửi tới**. Trước đây đơn bên kia gửi tới bị ẩn (lọc theo chi nhánh của bên tạo), còn phiếu
  theo đơn lại gắn được vào đơn của chi nhánh khác.
- Gói: trả tiền giữa kỳ dùng thử giữ ngày dùng thử còn lại; cộng tháng không tràn (31/01 + 1 tháng = 28/02, theo giờ
  Việt Nam). Webhook khoá ý định thanh toán trước khi xét — hai giao dịch khác mã cùng trả một ý định không gia hạn
  hai lần. `bank_transactions.outcome` (`applied | intent_closed | underpaid | no_intent`): giao dịch có mã mà không
  gia hạn cũng được ghi để đối soát; quản trị viên mở gói bằng mã đã ghi (chưa `applied`) được.
- `linkedBalance` — không đổi hình dạng; đọc phiếu theo trang thay vì nạp hết một lần.
- `DELETE /v1/me` — xoá tổ chức là bên sổ của kết nối đang active ⇒ bên được xem nhận `link.revoked`. Xét lại người
  trong tổ chức ngay trong transaction xoá (khoá hàng tổ chức): người được thêm giữa bước kiểm và bước xoá → 422.
- `@mambo/core`: `emptyData()` **không còn** bốn mặt hàng `prod-…` (sổ có máy chủ kéo mặt hàng id UUID về);
  `normalize()` không tự thêm chúng, bỏ bản `prod-…` trùng tên với mặt hàng id thật. Mới: `starterData()` (sổ chỉ
  nằm trên máy, có sẵn bốn mặt hàng), `withoutLegacyProducts()`, `isLegacyProductId()`. `extendPeriod(…, trialEnd?)`.

## 0.17.0 — 18/10/2026 (xoá tài khoản không làm sổ bên kia mất đơn)

- **Phá vỡ có chủ đích:** `OrderSummary.counterpart` (cả `OrderDetail`, `OrdersListResult`) thành `OrgRef | null`.
  `null` = bên kia đã xoá tài khoản: đơn và lịch sử đơn vẫn ở trong sổ của mình, đơn còn mở đã tự huỷ (mốc
  `cancelled`, `by: 'counterpart'`), bên còn lại nhận `order.cancelled` / `link.revoked` như mọi lần huỷ. Trước đây
  những đơn này bị xoá cùng tài khoản bên kia nên không bao giờ gặp `null`. App phải đọc `counterpart?.` —
  **nâng app lên 0.17 TRƯỚC rồi mới deploy API**.
- `OrderSummary.partnerName: string | null` — tên dòng danh bạ `partnerId` như mình ghi trong sổ (cả dòng đã xoá
  mềm); dùng để hiện tên khi `counterpart` null. Mình không có sổ (nông dân) ⇒ luôn `null`. API ≤ 0.16 không gửi
  trường này ⇒ schema mặc định `null` (SDK 0.17 đọc được API cũ; SDK ≤ 0.16 gặp `counterpart: null` thì báo
  `CONTRACT_MISMATCH` cho cả danh sách đơn).
- `DELETE /v1/me` (không đổi hình dạng): tổ chức bị xoá là bên được xem của một kết nối ⇒ kết nối ở lại trong
  sổ bên kia thành `revoked`, `counterpart: null`; bên sổ mời lại được bằng `linksInvite`.

## 0.16.0 — 18/10/2026 (xác nhận email · quên mật khẩu · một luật mật khẩu)

- `PASSWORD_MIN_LENGTH` (8), `PASSWORD_MAX_LENGTH` (72), schema `Password` — một luật cho mọi chỗ đặt mật khẩu.
  `OrgMemberCreateInput.password`, `AdminResetPasswordInput.newPassword` dùng nó (vẫn 8–72, không đổi nghĩa).
  App phải dùng cùng hằng số cho đăng ký / đổi mật khẩu (trước đây 6) và Supabase Auth đặt tối thiểu 8.
- `MeProfile.recoveryEmailVerified: boolean` — chỉ email đã xác nhận nhận thư đặt lại mật khẩu.
- `routes.meRecoveryEmailVerify` — `POST /v1/me/recovery-email/verify` → `RecoveryEmailVerifyResult
  { status: 'sent' | 'already_verified' | 'no_email' | 'too_soon' }`. Đổi email ở `meProfileUpdate` (và đăng ký có
  email) tự gửi một thư.
- `routes.authRecoveryEmailConfirm` — `POST /v1/auth/recovery-email/confirm` (công khai) `{ token }` →
  `{ email: string | null }` (`null` = link sai / đã dùng / hết hạn).
- `routes.authPasswordReset` — `POST /v1/auth/password-reset` (công khai) `{ identifier }` → luôn `{ ok: true }`; thư
  có link `/dat-lai-mat-khau?token_hash=…&type=recovery` (app gọi `supabase.auth.verifyOtp`).
- `ErrorCode` thêm `EMAIL_UNAVAILABLE` (503) — máy chủ chưa cấu hình / không gửi được thư.
- `admin/users/reset-password` chỉ chặn (`HAS_RECOVERY_EMAIL`) khi email khôi phục ĐÃ xác nhận.
- `@mambo/sdk`: `requestPasswordReset`, `confirmRecoveryEmail`, `account.verifyRecoveryEmail`.

## 0.15.0 — 17/10/2026 (nháp giữ khoản cộng/trừ)

- `DraftInsert` / `DraftPatch` — thêm `adjustments?: PriceAdjustment[] | null` (tối đa 20; `null` = gỡ hết).
  `DraftRecord.adjustments: PriceAdjustment[] | null` (nháp cũ / chưa có khoản → `null`). API cũ (≤ 0.14) từ chối
  op mang trường này — nâng API trước rồi mới nâng app.
- `@mambo/core`: `DraftReceipt.adjustments?`; `completeDraft` mang khoản sang phiếu; `normalizeAdjustment` export.

## 0.14.0 — 16/10/2026 (bản đồ thu mua)

- `routes.placesList` — `GET /v1/places?bbox=minLng,minLat,maxLng,maxLat&kinds=trader,enterprise` →
  `PlacesList { items: Place[], truncated }`. Mọi người đã đăng nhập (cả nông dân), không cần tổ chức.
  Tối đa `PLACES_PAGE_LIMIT` (500) điểm, mới sửa trước. `routes.placeGet` — `GET /v1/places/:id` → `Place`;
  đã gỡ → 404 `NOT_FOUND`.
- `routes.orgPlacesList` · `orgPlaceCreate` · `orgPlaceUpdate` · `orgPlaceDelete` — `/v1/org/places[/:id]`,
  quyền mới `place:manage` (vựa owner, DN owner, DN manager). `kind` theo loại tổ chức. Tối đa
  `PLACES_PER_ORG_LIMIT` (100) điểm đang hiện mỗi tổ chức; vượt → 422 `VALIDATION_FAILED`,
  `details.reason: 'PLACE_LIMIT'`, `details.limit`. Gỡ = xoá mềm, trả `{ ok: true }`.
- Kiểu mới: `Place`, `PlaceInput`, `PlacePatch` (đổi vị trí gửi cả `lat` và `lng`), `PlacesQuery`, `BBox`,
  `PlacesList`, `PlaceDeleteResult`, `PLACE_KINDS` / `PlaceKind` / `hasPlaces`, `VN_BOUNDS`, `Latitude`,
  `Longitude`, `RouteQueryInput`.
- `@mambo/sdk`: nhóm `places` — `inView(query, signal?)`, `get`, `mine`, `create`, `update`, `remove`. Hàm gọi
  nội bộ nhận `AbortSignal`.

## 0.13.0 — 14/10/2026 (người làm không tự rời · việc của từng người)

- `routes.reportsMembers` — `GET /v1/reports/members?from&to` → `MemberActivityReport { from, to, members:
  MemberActivity[] }`. Chỉ chủ (`staff:manage`). Mỗi người: `member` (`OrgMember`), `receipts` (`ReportFigures`
  của phiếu người đó lập trong khoảng), `payments { count, amount }` (lần trả người đó ghi trong khoảng),
  `lastActiveAt` (lần cuối lập phiếu / ghi lần trả, mọi thời điểm; `null` = chưa làm gì). Người đã gỡ chỉ có mặt
  khi có việc trong khoảng. Khoảng như `reportsSummary`: `to` không gồm, tối đa 366 ngày.
- `routes.orgLeave` — **bỏ dần**: luôn 403 `FORBIDDEN`. Người làm không tự rời được, chỉ chủ gỡ ra
  (`orgMemberRemove`). Bỏ hẳn ở bản phát hành sau.
- `routes.meDelete` — người còn làm thuê ở tổ chức nào (membership không phải chủ, chưa bị gỡ) → 422
  `VALIDATION_FAILED`, `details.reason: 'STILL_MEMBER'`, `details.organizations`. Chủ gỡ ra rồi mới xoá được.
  `AccountDeleteResult.leftOrganizations` từ nay luôn rỗng (bỏ dần).
- `@mambo/sdk`: `reports.members({ from, to })`; `org.leave()` đánh dấu `@deprecated`.

## 0.12.0 — 13/10/2026 (màn Tài khoản theo vai)

- `routes.orgUpdate` — `PATCH /v1/org`, thân `OrgPatch { name }` (1–120 ký tự) → `OrgProfile { id, type,
  name }`. Chỉ **chủ**; người khác → 403 `FORBIDDEN`. Kiểm ở service — ma trận quyền không đổi.
- `routes.orgLeave` — `POST /v1/org/leave` → `OrgMember` (`status: 'removed'`). Người không phải chủ tự
  rời tổ chức đang làm việc, mất quyền ngay như bị gỡ; chủ → 403 `FORBIDDEN`. Đã rời mà gọi lại → 403
  `NOT_A_MEMBER`. Chủ thêm lại cùng số thì bật lại tài khoản cũ như sau khi gỡ.
- `@mambo/sdk`: `org.update(patch)`, `org.leave()`.

## 0.11.2 — 13/10/2026

Không đổi hợp đồng (hợp đồng đã có `orderId` từ 0.6.0). `@mambo/core`: `Transaction` và `DraftReceipt` có
`orderId?` — phiếu / nháp lập theo đơn (ô "Theo đơn" ở màn Tạo phiếu, FRONTEND §5.8). `normalize` giữ trường
này khi đọc lại sổ; `completeDraft` chuyển `orderId` từ nháp sang phiếu.

## 0.11.1 — 13/10/2026

Không đổi hợp đồng. `@mambo/core`: `upsertDraft` lưu đè nháp đã có thì giữ `createdAt` của bản cũ (trước đây
lấy theo input, thiếu thì là giờ hiện tại ⇒ mỗi lần lưu nháp "ngày tạo" nhảy về hôm nay). Bản sửa đã có ở
`src/core` của repo frontend — đưa về đây để frontend bỏ bản chép, cài `@mambo/core`.

## 0.11.0 — 07/10/2026 (BE10 · phát hành chung BE5 → BE10)

Bản phát hành đầu tiên sau `0.5.0`. Gồm mọi thay đổi của 0.6.0 → 0.10.0 dưới đây — các số đó chưa từng
được gắn tag riêng (BE5 → BE10 vào `master` cùng lúc, 04/10). BE10 không đổi hợp đồng: API production
từ chối khởi động khi thiếu bí mật, backup, rà lộ khoá — không đụng tới gói này.

## 0.10.0 — phát hành trong 0.11.0 (BE9)

- `routes.eventsTrack` — `POST /v1/events` (công khai, `optionalAuth`), thân `{ events: TrackedEvent[] }`
  (≤ 50) → `{ accepted, dropped }`. Sự kiện sai bị bỏ riêng, không 422 cả lô.
- `TrackedEvent` — `discriminatedUnion('name')`, 17 sự kiện của app, thuộc tính `strictObject` (không
  tên, SĐT, email, số tiền). `SERVER_EVENT_NAMES`: `plan_activated`, `order_fulfilled`, `link_accepted`
  — server tự bắn, app gửi bị bỏ.
- `RouteDef.optionalAuth` — route công khai mà client gửi token NẾU có (chỉ `eventsTrack`).
- `routes.adminFunnel` — `GET /v1/admin/funnel?from=&to=` (quản trị viên) → `AdminFunnel`.
- `@mambo/sdk`: `events.track`; route có `optionalAuth` gửi token nếu `getAccessToken` trả được.

## 0.9.0 — phát hành trong 0.11.0 (BE8)

- `routes.attachmentsUploadUrl` — `POST /v1/attachments/upload-url` (`receipt:create`), thân
  `AttachmentUploadInput { attachmentId, contentType: image/jpeg|png|webp, size ≤ 3MB }` →
  `AttachmentUploadUrl { uploadUrl, method: 'PUT', headers, expiresAt }`. Không ghi đè: PUT lại → 409 = xong.
- `routes.attachmentUrl` — `GET /v1/attachments/:id/url` (`book:sync`) → `AttachmentDownloadUrl { url,
  expiresAt }` (10 phút). Chỉ ảnh mà phiếu / nháp mình được thấy nhắc tới; chưa lên → 404.
- Hằng số `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_TYPES`.
- `@mambo/sdk`: `attachments.uploadUrl/upload/url` — `upload(id, blob)` xin URL, PUT, coi 409 là xong.

## 0.8.0 — phát hành trong 0.11.0 (BE6)

- `RouteAuth` thêm `'admin'`: JWT của tài khoản có id trong `ADMIN_USER_IDS` của API; người khác → 403.
- `routes.meProfile` · `meProfileUpdate` — `GET/PATCH /v1/me/profile` (`MeProfile`, `MeProfilePatch
  { name?, username?, recoveryEmail? }`). Tên đăng nhập trùng → 422 `fields.username`; email khôi phục
  tài khoản khác đang dùng → 422 `fields.recoveryEmail`.
- `Username` (dùng cho `MeBootstrapInput.username` và `MeProfilePatch.username`): không được giống số điện
  thoại (`isPhoneLike` của core) — đăng nhập một ô tra SĐT trước. Database giữ cùng luật.
- `routes.meDelete` — `DELETE /v1/me` → `AccountDeleteResult { deletedOrganizations, leftOrganizations }`.
  Xoá thật; tổ chức còn người làm → 422 `details.reason: 'ORG_HAS_MEMBERS'`.
- `routes.meSubscription` — `GET /v1/me/subscription` (`billing:manage`) → `SubscriptionView { plan,
  trialEndsAt, currentPeriodEnd, selfServe, prices }`.
- `routes.billingIntentsList` · `billingIntentsCreate` — `GET/POST /v1/billing/intents` (`billing:manage`,
  chỉ vựa tự mua), thân `{ months: 1 | 12 }` → `PaymentIntentView { id, amount, months, code,
  transferContent, status, createdAt }`. Gọi lại trong 24 giờ → cùng ý định.
- `routes.referralsClaim` — `POST /v1/referrals/claim { code }` → `{ claimed }`, luôn 200.
- `routes.webhooksBank` — `POST /v1/webhooks/bank` (Casso / SePay; bí mật ở header) → `{ handled, skipped }`.
- `routes.adminActivatePlan` — `POST /v1/admin/plans/activate`; `routes.adminResetPassword` —
  `POST /v1/admin/users/reset-password`. Cả hai bắt buộc `approvedBy`, ghi `admin_access_log`.
- `@mambo/sdk`: `account.profile/updateProfile/claimReferral/delete`, `billing.subscription/intents/createIntent`.

## 0.7.0 — phát hành trong 0.11.0 (BE7)

- `routes.orgMembersList` — `GET /v1/org/members` (`staff:manage`) → `OrgMembersList { members: OrgMember[] }`.
- `routes.orgMembersCreate` — `POST /v1/org/members` (`staff:manage`), thân `OrgMemberCreateInput
  { name, phone, password, role: 'manager'|'staff', branchId? }` → `OrgMember`. Chủ tạo tài khoản
  cho người đó. Số đã có tài khoản nơi khác → 422 `details.reason: 'ACCOUNT_EXISTS'`; đã trong tổ
  chức → `'ALREADY_MEMBER'`; từng bị gỡ khỏi tổ chức này → bật lại, giữ tài khoản và mật khẩu cũ.
- `routes.orgMemberUpdate` — `PATCH /v1/org/members/:id` `{ role?, branchId? }`;
  `routes.orgMemberRemove` — `DELETE /v1/org/members/:id` (mất quyền ngay, gọi lại an toàn). Không
  sửa / gỡ được chủ hay chính mình (`FORBIDDEN`).
- `routes.orgBranchesList` — `GET /v1/org/branches` (`branch:manage`) → `{ branches, limit, used }`;
  `routes.orgBranchesCreate` — `POST` `{ name, address? }`; `routes.orgBranchUpdate` — `PATCH /:id`
  `{ name?, address?, archived? }`. Vượt gói → 402 `BRANCH_LIMIT` `details.limit`.
- `routes.reportsSummary` — `GET /v1/reports/summary?from=&to=&branchId=` (`report:view`) →
  `ReportSummary { from, to, totals, branches }`, `ReportFigures { purchase, sale }` mỗi bên
  `{ count, netWeight, amount, paid, debt }`. Nông dân: phiếu vựa ghi về mình, lật chiều.
- Kiểu mới: `IdParams`, `BranchRef`, `MemberStatus`, `AssignableRole`.
- `@mambo/sdk`: `org.members.list/create/update/remove`, `org.branches.list/create/update`, `reports.summary`.

## 0.6.0 — phát hành trong 0.11.0 (BE5)

- `routes.ordersList` — `GET /v1/orders?role=&status=&cursor=&limit=` → `OrdersListResult
  { orders: OrderSummary[], cursor }`, mới tạo trước. Cần `order:create` hoặc `order:respond`.
- `routes.ordersCreate` — `POST /v1/orders` (`order:create`), thân `OrderCreateInput { role,
  counterpartOrgId, crop?, productId?, estQuantity, unit = 'kg', offeredPrice?, pickupAt?,
  pickupAddress?, note? }` → `OrderSummary`. Chưa kết nối đúng chiều → `LINK_REQUIRED`.
- `routes.orderGet` — `GET /v1/orders/:id` → `OrderDetail` (= `OrderSummary` + `events`).
- `routes.orderAccept` · `orderReject` — `POST /v1/orders/:id/{accept,reject}` (`order:respond`, bên
  nhận đơn), thân `OrderTransitionInput { version, note? }`.
- `routes.orderSchedule` — `POST /v1/orders/:id/schedule` (`order:respond`, bên mua), thân
  `OrderScheduleInput { version, pickupAt, pickupAddress?, note? }`. Hẹn lại được.
- `routes.orderCancel` — `POST /v1/orders/:id/cancel`, bên nào cũng được. Mọi bước chuyển: version
  lệch hoặc trạng thái không cho → 409 `ORDER_STATE_CHANGED` kèm `details { status, version }` mới.
- `routes.notificationsList` — `GET /v1/notifications?cursor=&limit=` → `NotificationsResult
  { notifications, unread, cursor }`. `routes.notificationsRead` — `POST /v1/notifications/read
  { ids? }` → `{ unread }`; bỏ `ids` = tất cả.
- `NotificationKind` liệt kê sẵn cả loại của BE6/BE7 (`member.*`, `plan.activated`).
- Sync: `orderId` (tuỳ chọn) trong `TransactionInsert`, `DraftInsert`/`DraftPatch`; `orderId` trong
  `TransactionRecord`, `DraftRecord`. Phiếu theo đơn còn mở → đơn `fulfilled`; đơn đã huỷ, không còn
  hay sai bên → phiếu / nháp vẫn ghi, `orderId` bị gỡ, `warning: ORDER_NOT_OPEN` (không bao giờ
  `rejected` vì đơn — op bị từ chối làm cả hàng đợi dừng).
- Tổ chức lại file (không đổi export): `RouteDef` ở `route-def.ts`, route BE5 ở
  `routes-orders.ts`, phép kiểm khớp kiểu với core ở `sync-records-core.ts`.
- `@mambo/sdk`: `orders.list/create/get/accept/reject/schedule/cancel`, `notifications.list/read`.

## 0.5.0 — 03/10/2026 (BE4)

- `RouteDef.params` — tham số trên đường dẫn (`/v1/links/:id/accept`): server kiểm như thân
  request (`@ContractParams()`), SDK điền vào đường dẫn, openapi viết `{id}` + `in: path`. Kiểu
  tiện ích `RouteWithParams`, `RouteParams<N>`, hàm `pathParamNames`.
- `routes.linksList` — `GET /v1/links` → `LinksList { links: LinkSummary[] }`, cả hai phía
  (`side: owner | linked`), kèm tổ chức bên kia (`counterpart`).
- `routes.linksInvite` — `POST /v1/links/invite` (`partner:manage`), thân `LinkInviteInput
  { partnerKind, partnerId }` → `LinkSummary` kèm `inviteCode { code, expiresAt }` (mã kết nối 8
  ký tự, hạn `LINK_CODE_TTL_DAYS` = 7 ngày). Idempotent: mã còn hạn → đúng mã cũ; hết hạn → mã mới.
  Dòng danh bạ không cần số điện thoại.
- `routes.linksClaim` — `POST /v1/links/claim` (`linked:read`, 10 lần/phút/IP), thân
  `LinkClaimInput { code }` → `LinkSummary` (`active`). `LinkCode` chuẩn hoá chữ thường, khoảng
  trắng, gạch nối. Mã sai / đã dùng / hết hạn → `NOT_FOUND` (một câu chung); mã của chính mình →
  `VALIDATION_FAILED`. **Đường chính để kết nối** (quyết định 01/10/2026).
- `routes.linksAccept` — `POST /v1/links/:id/accept` (`linked:read`) → `LinkSummary`. Số đã xác
  thực OTP phải trùng số được mời, không thì `PHONE_NOT_VERIFIED`. Cùng `linksDiscover`: **tạm ẩn**
  tới khi > 100 tổ chức trả phí (Phone provider tắt).
- `LinkSummary.inviteCode` — mã còn hạn, chỉ phía `owner` khi `pending`; còn lại `null`.
  Hằng `LINK_CODE_ALPHABET` (bỏ 0/O, 1/I/L), `LINK_CODE_LENGTH`, `LINK_CODE_TTL_DAYS`.
- `routes.linksRevoke` — `POST /v1/links/:id/revoke` → `LinkSummary`. Quyền theo phía.
- `routes.linkedReceipts` — `GET /v1/linked/receipts?orgId=&cursor=&limit=` (`linked:read`) →
  `LinkedReceiptsResult { receipts: LinkedReceipt[], cursor }`; chưa kết nối → `LINK_REQUIRED`.
- `routes.linkedBalance` — `GET /v1/linked/balance` (`linked:read`) → `LinkedBalance
  { items: [{ organization, theyOwe, youOwe, receiptCount, lastReceiptAt }] }`.
- Kiểu mới: `PartnerKind`, `LinkStatus`, `LinkSide`, `OrgRef`, `LinkedReceiptLine`.
- `/links/discover`: `created` giờ đếm cả lời mời của vựa vừa được nhận về. Hình dạng không đổi.
- `@mambo/sdk`: `links.list/invite/claim/discover/accept/revoke`, `linked.receipts/balance`.

## 0.4.0 — 28/09/2026 (BE3)

- `routes.syncPush` — `POST /v1/sync/push` (`book:sync`), thân `SyncPushRequest`
  `{ deviceId, ops: SyncOp[] }` (1–`SYNC_PUSH_MAX_OPS` = 200 op, `seq` tăng dần, `opId` không
  trùng), trả `SyncPushResult` `{ results: [{ opId, status, error?, warning? }] }`. `status`:
  `applied | duplicate | rejected`; dừng ở op `rejected` đầu tiên — op sau không có trong
  `results`. `warning`: `RECORD_DELETED | ORDER_NOT_OPEN` (op đã nhận, không phải lỗi). Lỗi riêng
  `PLAN_EXPIRED` (402) cho cả lượt. Cổng chỉ kiểm vỏ (`SyncPushInput`); `data` kiểm theo từng op.
- `routes.syncPull` — `GET /v1/sync/pull?cursor=&limit=` (`book:sync`, `limit` 1–1000, mặc định
  500), trả `SyncPullResult` `{ cursor, hasMore, resetRequired, changes }`. `changes` có 8 danh
  sách `*Record`, gồm cả bản ghi đã xoá mềm.
- Hình dạng từng bản ghi (`sync-records.ts`): `PartyInsert/Patch/Record` (người bán, người mua),
  `Product*`, `PricingRule*`, `Note*`, `Draft*`, `Transaction*` (dòng phải đóng băng —
  `FrozenTransactionLine`), `PaymentInsert/Record` (không có patch). Khách lẻ =
  `counterpartyId: null`. Kiểu được kiểm lúc biên dịch là trùng `@mambo/core/types`.
- `SyncOp` (hình dạng đầy đủ), `SyncOpEnvelope`, `SYNC_ENTITIES` (cũng là thứ tự kéo về — lần
  trả tiền cuối), `SYNC_OP_DATA`, `SYNC_CHANGE_KEY`, `parseSyncOp` (kiểm một op — app dùng được
  trước khi đưa vào hàng đợi).
- `SYNC_PERMISSION` + `syncOpPermission(op)`: quyền của từng op ngoài `book:sync`. Tạo người
  bán/người mua/mặt hàng mới và sửa CHỈ giá gần nhất của mặt hàng cần `receipt:create` (người
  cân làm được); xoá phiếu `receipt:delete`; huỷ lần trả `payment:void`.
- `RouteDef` thêm `query?` (tham số query string, kiểm như thân request) và `docBody?` (thân như
  tài liệu mô tả khi `body` cố ý lỏng hơn). Kiểu tiện ích `RouteWithQuery`, `RouteQuery<N>`.
  `openapi.json`: tham số `in: query`.
- `@mambo/sdk`: `sync.push(input)`, `sync.pull({ cursor?, limit? })`; `call` dựng query string.
- `/v1/me/bootstrap`: vựa và doanh nghiệp mới có sẵn 4 mặt hàng mặc định (id UUID do server
  sinh). Hình dạng không đổi.

## 0.3.0 — 22/09/2026 (BE2)

- `routes.meBootstrap` — `POST /v1/me/bootstrap`, thân `MeBootstrapInput`
  (`orgType`, `orgName`, `name`, `phone?`, `username?`), trả `Me`. Idempotent.
- `routes.resolveIdentifier` — `POST /v1/auth/resolve-identifier` (công khai, 10 lần/phút/IP),
  thân `ResolveIdentifierInput`, trả `ResolveIdentifierResult` `{ email }`. **Luôn** trả một
  email, kể cả khi không có tài khoản — app luôn báo một câu chung khi đăng nhập hỏng.
- `routes.linksDiscover` — `POST /v1/links/discover` (`linked:read`), trả `LinksDiscoverResult`
  `{ created, pending }`; lỗi riêng `PHONE_NOT_VERIFIED`.
- `RouteDef` thêm `body?`, `rateLimitPerMinute?`, `errors?` (chỉ thêm, không đổi trường cũ).
  Kiểu tiện ích `RouteWithBody`, `RouteBody<N>`.
- `openapi.json`: `requestBody`, `x-error-codes`, `x-rate-limit-per-minute`; route có thân
  hoặc cần tổ chức khai báo 422.
- `/v1/me`: `memberships` và `pendingLinks` giờ là dữ liệu thật (trước đây luôn `[]` / `0`).
  Hình dạng không đổi.
- `@mambo/sdk`: `meBootstrap(input)`, `resolveIdentifier(input)`, `discoverLinks()`; `call` gửi
  thân JSON.

## 0.2.0 — 21/09/2026 (BE1)

- `ErrorCode` thêm `NOT_FOUND` (404) và `PAYLOAD_TOO_LARGE` (413) — cho đường dẫn lạ và thân
  request quá 1MB. Chỉ thêm, không đổi mã cũ.
- `routes`: danh bạ endpoint — `health` (công khai), `me` (cần đăng nhập). Controller, SDK
  và `openapi.json` cùng đọc từ đây.
- `Health`, `AppEnv`.
- `Me`, `MeUser`, `MeMembership`, `PlanSummary`, `Feature`, `SubscriptionStatus`,
  `PlanTier` — khớp KH backend §3.2. `SubscriptionStatus`/`PlanTier` được kiểm lúc biên dịch
  là trùng với `@mambo/core/subscription`.
- `openapi.json` (OpenAPI 3.1) đi kèm gói; sinh bằng `npm run openapi`.
- Gói mới **`@mambo/sdk`** 0.2.0: `createClient({ baseUrl, getAccessToken, getOrganizationId })`
  → `health()`, `me()`; lỗi là `ApiError` với `code` của hợp đồng; phản hồi sai hợp đồng →
  `CONTRACT_MISMATCH`.
- Import tương đối trong mọi gói có đuôi `.js`, để `.d.ts` dùng được cả với
  `moduleResolution: nodenext` (NestJS) lẫn `bundler` (Vite).

## 0.1.0 — 21/09/2026

- `ErrorCode` (12 mã), `ERROR_STATUS`, `ErrorBody`, `isRetryable` — KH backend §3.1.
- `OrgType` (`farmer | trader | enterprise`), `MemberRole` (`owner | manager | staff`),
  `hasBook` — KH backend §1.2.
- `Permission` (15 quyền), `PERMISSIONS_BY`, `permissionsOf`, `can` — ma trận KH backend §1.6.
