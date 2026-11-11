const mongoose = require('mongoose');

// Участник партнёрской программы. Логика взята из Siberi (UserAffiliate), но
// деньги устроены иначе, и это принципиально:
//
// В Siberi баланс менялся «прочитать → изменить → сохранить». Два одновременных
// запроса на вывод оба видели полный баланс и оба проходили — деньги можно было
// снять дважды. Здесь каждое изменение денег — один атомарный $inc с условием в
// самом запросе (см. lib/affiliate.js), и такой гонки быть не может.
//
// Деньги партнёра живут в трёх «корзинах»:
//   held      — начислено, но ещё на удержании (оплату могут вернуть);
//   balance   — доступно к выводу;
//   reserved  — запрошено к выводу и ждёт решения администратора.
const affiliateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
  code: { type: String, required: true, unique: true, uppercase: true },

  held: { type: Number, default: 0, min: 0 },
  balance: { type: Number, default: 0, min: 0 },
  reserved: { type: Number, default: 0, min: 0 },
  totalEarned: { type: Number, default: 0 },
  totalWithdrawn: { type: Number, default: 0 },

  referralsCount: { type: Number, default: 0 },
  // Уникальные переходы по ссылке /p/КОД (один браузер — один раз, боты не в счёт).
  // Только для статистики: на деньги не влияет никак, поэтому накрутка ничего не даёт.
  clicks: { type: Number, default: 0 },
  // Заблокированный партнёр перестаёт получать комиссии (фрод, спам).
  blocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Affiliate', affiliateSchema);
