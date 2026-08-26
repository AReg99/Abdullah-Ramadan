# 10. Importing the catalogue from Instagram · استيراد المنتجات من انستجرام

Your products are already photographed and captioned on your Instagram page.
This brings them into Aura instead of typing them all again.

---

## ENGLISH

### What it does

**Setup → Products → Import from Instagram** reads your posts, shows them as a
grid, and turns the ones you tick into products — name, price, and the picture,
downloaded onto your own server so the catalogue keeps working whatever happens
to the post.

Imported products arrive as **drafts, switched off**. A product with a price of
zero must not be sellable by accident, so you check each one and activate it.

It uses Instagram's own API with a token you paste. It is not scraping: scraping
breaks the week Instagram changes its page, and is against their terms anyway.

### What you need first

An **Instagram Business or Creator account**. A personal account cannot do this
— Instagram does not offer the API to personal accounts. Switching is free, in
the Instagram app under **Settings → Account type and tools → Switch to
professional account**.

### Getting the token

This is the only part that happens outside Aura, and it is fiddly the first
time. Roughly twenty minutes.

1. Go to **developers.facebook.com** and log in with the Facebook account that
   manages the page.
2. **My Apps → Create App**. Pick the type that offers **Instagram**. Give it any
   name — it is only for you, nobody sees it.
3. In the app, add the **Instagram** product and open its **API setup** section.
4. Connect your Instagram account when it asks, and accept the permissions —
   you need the one that lets it read your own media.
5. It shows you an **access token**. Copy the whole thing. It is long.
6. Paste it into Aura and press **Show posts**.

**The token is not stored.** Aura uses it for the two requests and forgets it.
That is deliberate: a long-lived Instagram token is a key to the account, and
this app has no reason to keep one. It also means you paste it again next time.

Tokens expire — typically after about two months. When it stops working, get a
fresh one the same way.

### Importing

1. Paste the token → **Show posts**.
2. Choose the **category** the products belong to.
3. Tick the posts that are products. Videos and carousels work: the first frame
   or first picture is used.
4. Correct the **name** — it is filled in from the caption's first line with the
   hashtags stripped, which is a starting point, not a product name.
5. Type the **price** if you know it. You can leave it and fill it in later.
6. **Import**.

Then go down the list, press **Edit** on each draft, check the price, and
**Activate**. Only then can it be sold.

### If it will not connect

- **"That token is wrong or expired"** — the commonest cause is copying only
  part of it. It is very long. Copy the whole thing.
- **No posts appear** — the account is probably still personal, or the token
  belongs to a different account than the page.
- **Some posts fail to import** — the count is reported. Usually a post with no
  still image at all.

### The simpler way

If the developer setup is more trouble than it is worth for twenty products:
save the pictures from Instagram to your phone, then add each product in
**Setup → Products** and use **Add photos**. Slower per product, nothing to set
up, and the result is identical.

---

## عربي

### بيعمل إيه

**الإعداد ← المنتجات ← استيراد من انستجرام** بيقرا البوستات من صفحتكم، ويعرضهالك،
واللي تختاره بيتحول لمنتج — بالاسم والسعر والصورة، والصورة بتتنزل على السيرفر
بتاعنا عشان الكتالوج يفضل شغال مهما حصل للبوست.

المنتجات المستوردة بتتسجل **مسودة ومقفولة**. المنتج اللي سعره صفر مينفعش يتباع
بالغلط، فلازم تراجع كل واحد وتفعّله بنفسك.

بيستخدم واجهة انستجرام الرسمية بتوكن انت بتلزقه. مش سحب بيانات من الصفحة —
ده بيقع أول ما انستجرام يغيّر حاجة، وكمان مخالف لشروطهم.

### محتاج إيه الأول

حساب انستجرام **Business أو Creator**. الحساب الشخصي مينفعش — انستجرام مش
بيتيح الواجهة للحسابات الشخصية. التحويل مجاني من تطبيق انستجرام:
**الإعدادات ← نوع الحساب والأدوات ← التحويل لحساب احترافي**.

### إزاي تجيب التوكن

الجزء ده بره أورا، وأول مرة بيكون متعب شوية. حوالي عشرين دقيقة.

1. ادخل **developers.facebook.com** بحساب الفيسبوك اللي بيدير الصفحة.
2. **My Apps ← Create App**، واختار النوع اللي فيه **Instagram**. سمّيه أي اسم —
   ده ليك انت بس.
3. جوه التطبيق، ضيف **Instagram** وافتح قسم **API setup**.
4. اربط حساب الانستجرام لما يطلب منك، ووافق على الصلاحيات.
5. هيوريك **access token**. انسخه كله — هو طويل جداً.
6. الزقه في أورا ودوس **اعرض البوستات**.

**التوكن مش بيتخزن.** أورا بتستخدمه في الطلبين وبتنساه. ده مقصود: التوكن ده
مفتاح للحساب، والتطبيق مش محتاج يحتفظ بيه. يعني هتلزقه تاني المرة الجاية.

التوكن بينتهي — غالباً بعد شهرين تقريباً. لما يقف، هات واحد جديد بنفس الطريقة.

### الاستيراد

1. الزق التوكن ← **اعرض البوستات**.
2. اختار **الفئة** اللي المنتجات دي تبعها.
3. علّم على البوستات اللي هي منتجات. الفيديو والكاروسيل شغالين: بياخد أول صورة.
4. صلّح **الاسم** — بيتملي من أول سطر في الكابشن من غير الهاشتاجات، وده بداية
   مش اسم منتج.
5. اكتب **السعر** لو تعرفه. تقدر تسيبه وتملاه بعدين.
6. **استورد**.

بعدين انزل على القايمة، دوس **تعديل** على كل مسودة، راجع السعر، و**فعّل**.
من غير كده مش هينفع يتباع.

### لو مش راضي يتصل

- **"التوكن غلط أو انتهى"** — أشهر سبب إنك نسخت جزء منه بس. هو طويل قوي.
- **مفيش بوستات ظهرت** — غالباً الحساب لسه شخصي، أو التوكن لحساب تاني.
- **بعض البوستات مستوردتش** — العدد بيتقالك. غالباً بوست مفيهوش صورة ثابتة أصلاً.

### الطريقة الأسهل

لو إعداد المطورين مش مستاهل عشان عشرين منتج: احفظ الصور من انستجرام على
موبايلك، وضيف كل منتج من **الإعداد ← المنتجات** واستخدم **إضافة صور**. أبطأ
شوية، بس مفيش أي إعداد، والنتيجة واحدة.
