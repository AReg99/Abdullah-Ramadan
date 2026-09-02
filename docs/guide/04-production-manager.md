# 4. Production manager · دليل مدير الإنتاج

Your job is not running the plant — that is the factory manager's. Yours is
**deciding what gets made in what order**, watching where the queue is piling
up, and knowing which promises are about to be missed *before* they are missed.

شغلك مش إدارة المصنع — ده شغل مدير المصنع. شغلك **تحدد إيه اللي يتعمل الأول**،
وتشوف الشغل مكدّس فين، وتعرف أنهي مواعيد هتضيع **قبل** ما تضيع.

Your screens: **التخطيط · اليوم · المصنع · الطلبات**, and the rest behind المزيد.

---

## ENGLISH

### The planning board (التخطيط)

Four tabs:

**الطابور — the queue.** Every work order not yet finished, in the order the
factory will actually reach them. The order is: priority first, then the promised
date, then the code. A piece with no promised date sorts last, which is correct —
nothing is waiting on it.

**الحمل — the load.** Minutes of work sitting at each station against what that
station can do in a day. This is the bottleneck, in one screen. If sanding shows
three days of work and assembly shows half a day, moving people is the answer,
not pushing harder.

**المواعيد — promises.** Every open order with the date the customer was given,
the date the factory's actual queue produces, and the gap. **Red means the
promise will be missed unless something changes.** This is the tab to open every
morning.

**المحطات — capacity.** How many productive minutes a day each station really
has. Set it honestly: the promise dates on every quotation come out of these
numbers, so a station set to 480 minutes that actually does 300 will hand the
showroom dates the factory cannot keep.

### Bumping a piece up the queue

On any row in الطابور: **رفع الأولوية**. It moves that work order ahead of the
others at its station.

**What it costs.** Bumping one piece pushes out everything behind it. The
المواعيد tab updates immediately, so you can see what you just broke before you
leave the screen. If bumping the rush job puts three other promises into red,
that is a conversation with the showroom, not a decision to take quietly.

### Where the dates come from

The app does not guess a lead time. It walks the real queue: for each station,
the work already ahead of this piece, at that station's real daily minutes, in
priority order. That is why the number moves when you bump something, and why it
is worth trusting.

**Only work ahead of this piece counts.** A later order does not push out an
earlier promise. If you see a promise move that should not have, tell the owner —
that is a bug, not a rounding.

### Blocked work

The **المصنع** screen shows every station and what is stopped. A blocked stage
carries a reason (no material, machine down, waiting on the customer, and so on)
and the minutes it has been stopped. Blocked minutes are excluded from the
worker's output, so nobody is penalised for waiting.

**Your job on this screen is the count, not the individual card.** Three pieces
blocked on "no material" at the same station is a purchasing problem; one piece
blocked all week is a forgotten piece.

### Spec changes on the floor

If the showroom changes what a piece is meant to be *after* the factory has
started, it lands in **المواصفات** and on the job card itself. Somebody on the
floor has to mark it seen. **Check that tab is empty before you go home** — an
unseen change is a piece being made to a spec that is no longer true.

---

## عربي

### شاشة التخطيط

**الطابور** — كل أوامر الشغل اللي لسه ما خلصتش، مرتبة زي ما المصنع هيوصلها
فعلاً: الأولوية الأول، بعدين الميعاد، بعدين الكود.

**الحمل** — دقايق الشغل المستنية على كل محطة مقابل اللي المحطة تقدر تعمله في
اليوم. ده عنق الزجاجة في شاشة واحدة.

**المواعيد** — كل أوردر مفتوح، والميعاد اللي اتقال للعميل، والميعاد اللي طابور
المصنع الحقيقي بيطلعه، والفرق. **الأحمر معناه الميعاد هيضيع** لو مفيش حاجة
اتغيرت. دي التبويبة اللي تفتحها كل صباح.

**المحطات** — كام دقيقة شغل فعلي في اليوم لكل محطة. اكتبها بصدق: كل المواعيد
اللي المعرض بيقولها للعملاء طالعة من الأرقام دي.

### رفع الأولوية

من أي سطر في الطابور: **رفع الأولوية**. القطعة بتتقدّم على اللي وراها في نفس
المحطة.

**التمن.** لما بتقدّم قطعة، اللي وراها بيتأخر. تبويبة المواعيد بتتحدث فوراً،
فتقدر تشوف إنت كسرت إيه قبل ما تسيب الشاشة. لو تقديم القطعة المستعجلة حوّل تلات
مواعيد للأحمر، ده كلام يتقال للمعرض، مش قرار يتاخد في السكوت.

### المواعيد جاية منين

التطبيق مابيخمّنش. بيمشي على الطابور الحقيقي: لكل محطة، الشغل اللي قدام القطعة
دي، بدقايق المحطة الحقيقية، بترتيب الأولوية. **الشغل اللي قدامك بس هو اللي
بيتحسب** — أوردر جديد مش بيأخّر وعد قديم.

### الشغل الواقف

شاشة **المصنع** بتوريك كل محطة وإيه اللي واقف. كل وقفة ليها سبب والدقايق اللي
وقفتها. **الدقايق دي مابتتحسبش على العامل** — محدش بيتحاسب على انتظار.

شغلك في الشاشة دي هو **العدد**، مش الكارت الواحد. تلات قطع واقفة على "مفيش خامة"
في نفس المحطة دي مشكلة مشتريات؛ قطعة واحدة واقفة أسبوع دي قطعة اتنسيت.

### تغيير المواصفات على الخط

لو المعرض غيّر مواصفات قطعة **بعد** ما المصنع بدأ فيها، التغيير بيظهر في
**المواصفات** وعلى كارت الشغل نفسه، ولازم حد من المصنع يعلّم إنه شافه. **اتأكد
إن التبويبة دي فاضية قبل ما تمشي** — تغيير محدش شافه معناه قطعة بتتعمل بمواصفات
مابقتش صح.
