# 3. Factory manager & supervisor · دليل مدير المصنع والمشرف

You are the only person who commits the factory to a date. Everything downstream
— the customer's promise, the owner's report, the showroom's credibility —
depends on the decisions on this page.


> **What is in the app today.** **Today** and **Floor** show you the live
> factory, and the **Dispatch** tab is where production hands over: every piece
> that has passed its last station appears there, and **Send to showroom** moves
> it out of the factory and onto the showroom's board. Until a line is
> dispatched it still counts as sitting in your building.
>
> The planning board and capacity commitments described below are the design for
> a later phase.

---

## ENGLISH

### Your daily rhythm

**07:30 — Blockers.** Open **Blockers** before anything else. It lists everything
paused, sorted by minutes lost, grouped by reason. Clear what you can before the
shift starts; a blocker cleared at 07:30 costs nothing, the same blocker at 11:00
costs half a day.

**08:00 — Incoming orders.** Accept or reject what the showroom sent yesterday.

**08:15 — Publish the plan.** Confirm today's assignments on the planning board.
Workers see their list when they log in.

**Through the day.** React to blocked-stage alerts. Everything else can wait.

**17:00 — Tomorrow's plan.** Review the board, resolve overbooking, publish. The
system notifies each station.

### Accepting an order from the showroom

Every showroom order arrives as **pending acceptance** and shows you three things
before you decide: the station minutes it needs, whether its materials are
available, and the earliest date the scheduler can fit it.

- **Accept** — the capacity slot is committed, the promise date is locked, and the
  showroom and customer are told automatically.
- **Reject** — you must give a reason and a counter-date. The showroom gets both
  and goes back to the customer with a real alternative.

**Never accept a date you do not believe.** An accepted date is a promise the
company has made, and it becomes the on-time number the owner reads every week.
Rejecting with an honest counter-date costs one awkward conversation today;
accepting a date you cannot hit costs a customer.

### The planning board

Days across the top, stations down the side, work orders as blocks you drag.

- The bar under each station shows **capacity used against available**. Green is
  fine, amber is tight, red is overbooked.
- The board **refuses to overbook** without an override. When you override, you
  record a reason, and it appears on the owner's monthly report. This is a
  deliberate friction, not an obstacle — an overbooked station is how a factory
  quietly becomes three weeks late.
- **Rush insertion** shows you exactly which orders get pushed back and which
  customers must be told, before you confirm. Decide with that list in front of
  you.

### Clearing blockers — what each reason needs

| Reason | The real fix |
| --- | --- |
| No material | Check the shortage list; if it is a recurring material, the reorder point is wrong, not purchasing |
| Machine down | Log maintenance; if the same machine appears weekly, it is a capital decision, not a repair |
| Awaiting drawing | Chase the designer; if this is frequent, engineering is starting too late in the custom flow |
| Awaiting quality | The inspector is a bottleneck — spread inspections across the day rather than batching them |
| Awaiting customer | Not your problem to fix — push it to the sales rep and let the order sit, but make sure the promise date is recalculated |
| Missing component | Usually a BOM error; fix the BOM, not just this job |
| Short of labour | Reassign from a station running under capacity |

**Time in a blocked state is measured and reported.** That is the point of forcing
a reason code — it converts a vague complaint into a number you can act on.

### Quality and rework

Open **Quality** weekly. It shows failures and rework by station, by product, and
by defect code, with photos.

When you raise a rework, choose the attribution honestly: workmanship, material
defect, design error, spec error taken in the showroom, or a customer change.
This is not blame — it is how the business finds out that, for example, a third
of its rework comes from measurements taken badly in the showroom, which is a
training problem, not a factory problem.

### Materials

The **Materials** screen shows what is below its reorder point, what is reserved
against what is available, and which shortages are blocking scheduled work orders.
Check it every morning. A shortage found on the planning board is manageable; the
same shortage found by a worker at the bench costs a day.

---

## بالعربية

### روتينك اليومي

**٧:٣٠ — المتوقفات.** افتح شاشة **المتوقفات** قبل أي حاجة. بتعرض كل حاجة واقفة،
مرتبة حسب الدقايق الضايعة، ومجمعة حسب السبب. حلّ اللي تقدر عليه قبل بداية الوردية.
المشكلة اللي بتتحل ٧:٣٠ متكلفش حاجة؛ نفسها الساعة ١١ بتكلف نص يوم.

**٨:٠٠ — الطلبات الواردة.** اقبل أو ارفض اللي المعرض بعته إمبارح.

**٨:١٥ — اعتماد خطة اليوم.** أكّد التوزيع على لوحة التخطيط. العمال بيشوفوا قايمتهم
أول ما يسجلوا دخول.

**١٧:٠٠ — خطة بكرة.** راجع اللوحة، حلّ أي تحميل زيادة، واعتمد.

### قبول طلب من المعرض

كل طلب بيوصل بحالة **في انتظار القبول**، وبيوريك تلات حاجات قبل ما تقرر: كام
دقيقة إنتاج محتاج، الخامات متوفرة ولا لأ، وأقرب تاريخ ممكن.

- **قبول** — الطاقة بتتحجز، الموعد بيتثبت، والمعرض والعميل بيتبلغوا تلقائياً.
- **رفض** — لازم تكتب السبب وتاريخ بديل. المعرض بياخد الاتنين ويرجع للعميل ببديل حقيقي.

**متقبلش تاريخ إنت مش مصدقه.** التاريخ المقبول وعد من الشركة، وبيتحول لنسبة
التسليم في الموعد اللي المالك بيقراها كل أسبوع. الرفض بتاريخ بديل صادق بيكلفك
مكالمة واحدة صعبة النهاردة؛ قبول تاريخ مستحيل بيكلفك عميل.

### لوحة التخطيط

- الشريط تحت كل محطة بيوري **الطاقة المستخدمة مقابل المتاحة**. أخضر تمام، أصفر
  ضيق، أحمر محمّل زيادة.
- اللوحة **بترفض التحميل الزائد** إلا بتجاوز، والتجاوز بيتسجل بسببه وبيظهر في
  تقرير المالك الشهري. الاحتكاك ده مقصود.
- **إدخال طلب مستعجل** بيوريك بالظبط أنهي طلبات هتتأخر وأنهي عملاء لازم يتبلغوا،
  قبل التأكيد.

### الجودة وإعادة الشغل

لما تسجل إعادة شغل، اختار السبب بصدق: صنعة، عيب خامة، خطأ تصميم، خطأ في
المقاسات المأخوذة في المعرض، أو تعديل من العميل. ده مش تحميل مسئولية — ده اللي
بيخلي الشركة تكتشف إن تلت إعادة الشغل سببها مقاسات بتتاخد غلط في المعرض، وده
موضوع تدريب مش موضوع مصنع.
