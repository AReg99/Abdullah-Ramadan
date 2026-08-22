# 09 — Arabic & English

Aura ships in **Arabic and English from day one**. Arabic is not a translation
layer added at the end — it is the default language of the factory floor, the
showroom, and the customer, and the system is built that way.

| Surface | Default | Second language |
| --- | --- | --- |
| Worker app, QC app, storekeeper | **Arabic** | English (toggle) |
| Showroom app | **Arabic** | English (toggle) |
| Customer tracking page & messages | **Arabic**, or the customer's stored preference | English |
| Driver app | **Arabic** | English |
| Owner app | per-user preference | both fully supported |
| Factory & office web console | per-user preference | both fully supported |
| Printed documents (quote, invoice, delivery note, warranty) | **bilingual on one page** | — |

## 1. How the language is chosen

1. **Staff** — `users.locale` (`ar` \| `en`), set at account creation, changeable
   by the user at any time from a persistent header toggle. It applies instantly,
   with no reload and no loss of the current screen.
2. **Customers** — `customers.locale`, captured by the sales rep when the
   customer record is created. It governs the tracking page, every WhatsApp
   message, and the documents they receive.
3. **Anonymous visitors** to a tracking link — the `Accept-Language` header,
   falling back to Arabic, overridable by a toggle on the page itself.

The locale travels with every API request (`Accept-Language`), so
server-generated content — PDFs, WhatsApp templates, exported reports — comes
back in the right language without the client having to ask twice.

## 2. Bilingual data, not just a bilingual interface

Interface strings are translated once by us. **Business data is bilingual by
schema**, because a product name is content, not a label:

```
products(name_ar, name_en, description_ar, description_en)
options(name_ar, name_en)
materials(name_ar, name_en)
routing_stages(name_ar, name_en)
qc_checklists.items[] -> {label_ar, label_en}
```

Rules that keep this from rotting:

- `name_ar` is **required**; `name_en` falls back to `name_ar` if empty, never
  the other way round.
- The admin UI shows both fields side by side on one form. You cannot save a new
  product with an empty Arabic name.
- A **missing-translation report** lists every catalogue record with a blank
  second-language field, so the gap is visible instead of silent.
- Anything a worker or customer will read — blocked reasons, defect codes,
  cancellation reasons, notification templates — is a bilingual lookup table, not
  a hard-coded English string.

## 3. Right-to-left is a layout, not a text direction

Setting `dir="rtl"` is about a tenth of the work. The rest:

**Mirrors in Arabic**
Page and navigation layout · sidebars and drawers · table column order · form
label alignment · progress bars and stepper flows (they run right→left) ·
breadcrumbs · directional icons (back, forward, next, indent) · the drop shadow
side · list bullets and numbering · swipe gestures.

**Never mirrors**
Numbers and numeric columns · phone numbers · times and durations · currency
amounts · the clock direction · technical drawings and product photos · QR codes
and barcodes · media player controls · logos.

**Handled deliberately**
- **Charts.** The category axis mirrors; a time axis does *not* — time still runs
  left→right in Arabic charting convention. Legends and tooltips mirror.
- **Mixed content.** An Arabic sentence containing a Latin order code
  (`ORD-0412`) needs explicit bidi isolation (`<bdi>` or `unicode-bidi: isolate`)
  or the code will render with its punctuation flipped. This is the single most
  common Arabic UI bug — put it in the review checklist.
- **CSS.** Use logical properties throughout — `margin-inline-start`,
  `padding-inline-end`, `inset-inline`, `text-align: start`. No `left`/`right` in
  application CSS at all; a lint rule enforces it.

## 4. Typography

| Role | Arabic | Latin |
| --- | --- | --- |
| Interface & body | **IBM Plex Sans Arabic** | IBM Plex Sans |
| Headings | IBM Plex Sans Arabic, 600 | Archivo, 700 |
| Codes, data, tables | IBM Plex Sans Arabic + **IBM Plex Mono** for the digits | IBM Plex Mono |

Practical notes that decide whether Arabic looks professional or amateur:

- Arabic needs **more line-height** than Latin — 1.8 against 1.65 — because of
  ascenders and descenders. Set it per-locale, not globally.
- Arabic has **no uppercase.** Every `text-transform: uppercase` label needs an
  Arabic variant that uses weight or colour for emphasis instead.
- Arabic text runs roughly **20–25 % longer** than English for the same meaning.
  Buttons and table headers must be sized for the Arabic string, or they will
  wrap in production and not in your mockups.
- Never letter-space Arabic. It breaks the joins between letters.
- Keep font weight at 400–600. Very light and very heavy Arabic weights lose
  legibility on the low-cost Android screens used on the floor.

## 5. Numbers, dates, money, addresses

- **Digits.** Western Arabic numerals (`0–9`) are the default — that is what
  Egyptian commerce, invoices and phone keypads use. Arabic-Indic digits
  (`٠–٩`) are available as a per-user preference. Store one canonical form;
  format at the edge.
- **Currency.** `EGP`. Arabic renders `12,450.00 ج.م`, English `EGP 12,450.00`.
  Amounts always use `font-variant-numeric: tabular-nums` so columns line up in
  both languages.
- **Calendar.** Gregorian, with **Egyptian Arabic month names** — يناير، فبراير،
  مارس — not the Levantine forms (كانون الثاني). Getting this wrong is
  immediately noticeable to an Egyptian user. Hijri dates are shown as a
  secondary line only where the business asks for it.
- **Time.** 24-hour by default; the shift schedule is unambiguous that way.
- **Phone numbers.** Stored E.164 (`+201xxxxxxxxx`), displayed locally, always
  rendered left-to-right inside Arabic text.
- **Addresses.** Free-form Arabic plus a map pin. Do not force a Western
  street/number structure onto an Egyptian address — the pin is the reliable part
  and is what the driver actually navigates to.

## 6. Strings, plurals, and search

**Key structure** — namespaced, never the English sentence as the key:
```
order.status.in_production
worker.action.start
notify.customer.out_for_delivery.body
```
Files: `locales/ar.json`, `locales/en.json`. CI fails on a key present in one
file and missing from the other.

**Arabic plurals are six forms, not two.** CLDR defines `zero, one, two, few,
many, other` for Arabic. `1 قطعة`, `2 قطعتان`, `3 قطع`, `11 قطعة` are all
different. Use ICU MessageFormat everywhere a count appears — a naive
`count + " " + word` will be wrong most of the time.

```
{count, plural,
  zero {لا توجد قطع} one {قطعة واحدة} two {قطعتان}
  few {# قطع} many {# قطعة} other {# قطعة}}
```

**Arabic search must normalise** before matching, or staff will not find their
own records:

| Normalise | Example |
| --- | --- |
| Alef variants → `ا` | `أحمد` `إحمد` `آحمد` all match `احمد` |
| Taa marbuta `ة` → `ه` | `كنبة` matches `كنبه` |
| Alef maqsura `ى` → `ي` | `مصطفى` matches `مصطفي` |
| Strip diacritics (tashkeel) and tatweel | `كــنبة` matches `كنبة` |

Implement as a Postgres generated column with a normalising function plus a
trigram index — not in application code, or half the queries will forget it.

## 7. Terminology glossary

The single most valuable part of this document. One agreed word per concept, used
in the app, in training, and in conversation — so "the order is in تشطيب" means
exactly one thing to everyone.

Where Egyptian furniture trade language differs from formal Arabic, **the trade
word wins**. The clearest example: a catalogue piece is **جاهز** and a made-to-
measure piece is **تفصيل**. Those are the words customers and workers already
use; forcing "منتج قياسي" would make the app feel foreign.

### Sales & orders
| English | العربية |
| --- | --- |
| Customer | عميل |
| Showroom | معرض |
| Inquiry | استفسار |
| Quotation | عرض سعر |
| Order | طلب |
| Standard order (catalogue) | طلب **جاهز** |
| Custom order (made to measure) | طلب **تفصيل** |
| Order line | بند الطلب |
| Deposit | عربون |
| Remaining balance | المبلغ المتبقي |
| Invoice | فاتورة |
| Discount | خصم |
| Delivery date | موعد التسليم |
| Lead time | مدة التنفيذ |
| Sales representative | مندوب مبيعات |

### Design & customisation
| English | العربية |
| --- | --- |
| Design brief | بيانات التصميم |
| Measurements | المقاسات |
| Technical drawing | الرسم الهندسي |
| Revision | تعديل |
| Customer approval | موافقة العميل |
| Signature | التوقيع |
| Preview photos | صور المعاينة |
| Fabric | قماش |
| Wood | خشب |
| Finish / colour | لون التشطيب |
| Hardware / fittings | إكسسوارات |
| Swatch / sample | عينة |
| Sample library | مكتبة العينات |

### Production
| English | العربية |
| --- | --- |
| Work order | أمر تشغيل |
| Routing | مسار التصنيع |
| Stage | مرحلة |
| Station | محطة |
| Cutting | التقطيع |
| Edge banding | تغليف الحواف |
| Assembly | التجميع |
| Sanding | التنعيم (السنفرة) |
| Finishing / paint | التشطيب (الدهان) |
| Curing / drying | التجفيف |
| Upholstery | التنجيد |
| Packing | التغليف |
| Finished goods | المنتجات التامة |
| Capacity | الطاقة الإنتاجية |
| Worker | عامل |
| Supervisor | مشرف |
| Factory manager | مدير المصنع |

### Quality
| English | العربية |
| --- | --- |
| Quality check | فحص الجودة |
| Pass / Fail | مطابق / غير مطابق |
| Defect | عيب |
| Rework | إعادة شغل |
| Scrap | هالك |
| Inspector | مفتش الجودة |
| Checklist | قائمة الفحص |

### Materials & stock
| English | العربية |
| --- | --- |
| Material | خامة |
| Bill of materials | قائمة الخامات |
| Stock | المخزون |
| On hand | الرصيد المتاح |
| Reserved | محجوز |
| Reorder point | حد إعادة الطلب |
| Purchase order | أمر شراء |
| Supplier | مورد |
| Stock count | جرد |
| Storekeeper | أمين المخزن |
| Warehouse | مخزن |

### Logistics
| English | العربية |
| --- | --- |
| Transfer | تحويل |
| Shipment | شحنة |
| Loading | التحميل |
| Out for delivery | خرج للتسليم |
| Delivered | تم التسليم |
| Installation | التركيب |
| Proof of delivery | إثبات التسليم |
| Failed delivery | تسليم لم يتم |
| Driver | سائق |

### Tracking & management
| English | العربية |
| --- | --- |
| Dashboard | لوحة المتابعة |
| Timeline | سجل المتابعة |
| Scan the code | امسح الكود |
| QR label | ملصق الكود |
| Serial number | الرقم المسلسل |
| Start | ابدأ |
| Pause | إيقاف مؤقت |
| Finish | إنهاء |
| Report a problem | بلّغ عن مشكلة |
| Blocked | متوقف |
| At risk of delay | معرّض للتأخير |
| Late | متأخر |
| On time | في الموعد |
| Notification | إشعار |
| Report | تقرير |
| Approval request | طلب موافقة |
| Warranty | ضمان |
| Complaint | شكوى |

### Blocked reasons — the fixed list, both languages
| Code | English | العربية |
| --- | --- | --- |
| `NO_MATERIAL` | No material | خامة ناقصة |
| `MACHINE_DOWN` | Machine down | عطل في الماكينة |
| `AWAITING_DRAWING` | Awaiting drawing | في انتظار الرسم |
| `AWAITING_QC` | Awaiting quality | في انتظار الجودة |
| `AWAITING_CUSTOMER` | Awaiting customer | في انتظار العميل |
| `MISSING_COMPONENT` | Missing component | قطعة ناقصة |
| `POWER` | Power cut | انقطاع الكهرباء |
| `LABOUR_SHORT` | Short of labour | نقص عمالة |
| `OTHER` | Other | سبب آخر |

## 8. Tone

Two registers, deliberately different:

- **Worker, driver, storekeeper apps** — short, direct, imperative, everyday
  Egyptian-comprehensible Arabic. `ابدأ` not `الرجاء البدء في تنفيذ المهمة`.
  A screen with three words on a button is a screen that gets used.
- **Customer messages and documents** — polite Modern Standard Arabic, warm but
  not flowery. Address the customer by name. Never machine-translate; every
  customer-facing template is written in Arabic first and then rendered into
  English, not the reverse.

Sample notification, both languages:

> **AR** — أ. محمد، تم الانتهاء من تصنيع طلبك رقم ORD-0412 واجتاز فحص الجودة.
> برجاء اختيار موعد التسليم المناسب من الرابط. — أورا للأثاث
>
> **EN** — Mr Mohamed, order ORD-0412 has finished production and passed quality
> inspection. Please choose your delivery slot using the link. — Aura Furniture

## 9. Bilingual printed documents

Quotation, invoice, delivery note, warranty certificate and the work-order job
card are printed **bilingual on a single page**, not as two separate documents:

- Arabic on the right column, English on the left, sharing one row per line item.
- Numbers, codes and totals in one shared centre column — they need no
  translation and duplicating them invites transcription errors.
- The legal and warranty text is Arabic-primary; English is a courtesy
  translation and the document says so in a footer line.
- The job card taken to the bench is **Arabic only**, at large type — it is a
  working document, not a legal one, and a bilingual layout would halve the font
  size for no benefit.

## 10. RTL review checklist

Run before every release; four of these have failed in almost every Arabic app
ever shipped.

- [ ] No `left` / `right` in application CSS — logical properties only
- [ ] Latin codes inside Arabic sentences wrapped in `<bdi>`
- [ ] Every uppercase label has a non-uppercase Arabic variant
- [ ] Arabic line-height set separately from Latin
- [ ] All counts go through ICU plurals with six Arabic forms
- [ ] Buttons and table headers still fit with the Arabic string (+25 % width)
- [ ] Progress steppers and breadcrumbs run right→left
- [ ] Charts: category axis mirrored, time axis not
- [ ] Search normalises alef, taa marbuta, alef maqsura, tashkeel
- [ ] Dates use Egyptian month names
- [ ] PDFs render Arabic with correct letter joining (test the PDF engine's
      shaping explicitly — this breaks silently and often)
- [ ] WhatsApp templates approved in both languages by Meta before launch
