// ─────────────────────────────────────────────────────────────────────────────
//  smartNaming.js — Smart Product Name Unification Engine
//  3045 Super Market POS
//
//  Output format: "Brand Product Size" / "اسم الشركة اسم المنتج الحجم"
//  For multipacks: "Brand Product Size (count)" / "... (عدد القطع)"
//
//  Strategy:
//    1. Tokenize current name (handle Arabic + English mixed strings)
//    2. Identify brand via dictionary lookup (longest match wins)
//    3. Extract size/volume/weight via regex
//    4. Extract pack count via regex
//    5. The remaining tokens become the product/flavor name
//    6. Translate Arabic ↔ English using product/flavor dictionary
//    7. Score confidence based on what was identified
//
//  No external dependencies. Runs client-side.
// ─────────────────────────────────────────────────────────────────────────────

// ═══ BRAND DICTIONARY ═══════════════════════════════════════════════════════
// Each entry: { en: canonical English, ar: canonical Arabic, aliases: [variants seen in data] }
// Aliases can be in either language — used to detect the brand in messy current names.
// Arrange by length (longest aliases first) so we don't match "matrix" inside "matrixone" by mistake.

export const BRANDS = [
  // Soft drinks
  { en: "Coca-Cola",   ar: "كوكا كولا",   aliases: ["coca-cola","coca cola","cocacola","coke","كوكاكولا","كوكا كولا","كوكا"] },
  { en: "Pepsi",       ar: "بيبسي",       aliases: ["pepsi-cola","pepsi cola","pepsi","بيبسي كولا","بيبسي"] },
  { en: "7Up",         ar: "سفن اب",      aliases: ["7-up","7 up","7up","seven up","sevenup","سفن اب","سفن أب","سفن-اب"] },
  { en: "Mirinda",     ar: "ميرندا",      aliases: ["mirinda","mirenda","ميرندا","ميرنده"] },
  { en: "Mountain Dew",ar: "ماونتن ديو",  aliases: ["mountain dew","mtn dew","ماونتن ديو","ماونتن"] },
  { en: "Sprite",      ar: "سبرايت",      aliases: ["sprite","سبرايت","سبرايتس"] },
  { en: "Fanta",       ar: "فانتا",       aliases: ["fanta","فانتا"] },
  { en: "Schweppes",   ar: "شويبس",       aliases: ["schweppes","شويبس","شيبس "] },
  { en: "Matrix",      ar: "ماتركس",      aliases: ["matrix","ماتركس","متركس"] },
  { en: "RC Cola",     ar: "آر سي كولا",  aliases: ["rc cola","rc-cola","rccola","آر سي","ار سي كولا"] },

  // Energy / sports
  { en: "Red Bull",    ar: "ريد بول",     aliases: ["red bull","redbull","ريد بول","ريدبول"] },
  { en: "Monster",     ar: "مونستر",      aliases: ["monster energy","monster","مونستر"] },
  { en: "Power Horse", ar: "باور هورس",   aliases: ["power horse","powerhorse","باور هورس","باورهورس"] },
  { en: "Sting",       ar: "ستينج",       aliases: ["sting","ستينج","ستنج"] },
  { en: "XL",          ar: "اكس ال",      aliases: ["xl energy","xl","اكس ال","إكس إل"] },
  { en: "Tiger",       ar: "تايجر",       aliases: ["tiger energy","tiger","تايجر","تايقر"] },
  { en: "Code Red",    ar: "كود ريد",     aliases: ["code red","كود ريد"] },
  { en: "Bison",       ar: "بايسون",      aliases: ["bison","بايسون"] },

  // Water / juices
  { en: "Nestle",      ar: "نستله",       aliases: ["nestle pure life","nestle","nestlé","نستله","نسلتيه"] },
  { en: "Aquafina",    ar: "أكوافينا",    aliases: ["aquafina","أكوافينا","اكوافينا"] },
  { en: "Tania",       ar: "تانيا",       aliases: ["tania","tanya","تانيا"] },
  { en: "Hayat",       ar: "حياة",        aliases: ["hayat","hayaat","حياة","حياه"] },
  { en: "Ghadeer",     ar: "غدير",        aliases: ["ghadeer","غدير"] },
  { en: "Sera",        ar: "سيرا",        aliases: ["sera","سيرا"] },
  { en: "Maaza",       ar: "مازا",        aliases: ["maaza","maza","مازا","مازه"] },
  { en: "Rauch",       ar: "راوخ",        aliases: ["rauch","راوخ"] },
  { en: "Almarai",     ar: "المراعي",     aliases: ["almarai","al marai","al-marai","المراعي"] },
  { en: "Al Rabie",    ar: "الربيع",      aliases: ["al rabie","al-rabie","alrabie","الربيع"] },
  { en: "Suntop",      ar: "صن توب",      aliases: ["suntop","sun top","صن توب","صنتوب"] },
  { en: "Rani",        ar: "راني",        aliases: ["rani","راني","رانى"] },

  // Chips / snacks
  { en: "Lay's",       ar: "ليز",         aliases: ["lay's","lays","leyz","ليز","لايز","لايس"] },
  { en: "Doritos",     ar: "دوريتوس",     aliases: ["doritos","دوريتوس","دوريتو"] },
  { en: "Cheetos",     ar: "تشيتوس",      aliases: ["cheetos","تشيتوس","شيتوس"] },
  { en: "Pringles",    ar: "برينجلز",     aliases: ["pringles","prengles","برينجلز","برنجلز","برنقلز"] },
  { en: "Tiffany",     ar: "تيفاني",      aliases: ["tiffany","تيفاني","تفاني"] },
  { en: "Mr. Chips",   ar: "مستر شيبس",   aliases: ["mr chips","mr. chips","mrchips","مستر شيبس","مستر شيبسي"] },
  { en: "Galbany",     ar: "غلباني",      aliases: ["galbany","غلباني"] },
  { en: "Master",      ar: "ماستر",       aliases: ["master snack","master chips","ماستر"] },

  // Chocolate / candy
  { en: "Cadbury",     ar: "كادبوري",     aliases: ["cadbury","cadburys","كادبوري","كاد بوري"] },
  { en: "Galaxy",      ar: "جالكسي",      aliases: ["galaxy","galaxie","جالكسي","غالاكسي"] },
  { en: "Mars",        ar: "مارس",        aliases: ["mars","مارس"] },
  { en: "Snickers",    ar: "سنيكرز",      aliases: ["snickers","snikers","سنيكرز","سنكرز"] },
  { en: "Twix",        ar: "تويكس",       aliases: ["twix","تويكس"] },
  { en: "Bounty",      ar: "باونتي",      aliases: ["bounty","باونتي"] },
  { en: "KitKat",      ar: "كيت كات",     aliases: ["kitkat","kit kat","kit-kat","كيت كات","كتكات"] },
  { en: "Milka",       ar: "ميلكا",       aliases: ["milka","ميلكا"] },
  { en: "Lindt",       ar: "ليندت",       aliases: ["lindt","ليندت"] },
  { en: "Ferrero",     ar: "فيريرو",      aliases: ["ferrero rocher","ferrero","فيريرو","فريرو"] },
  { en: "Nutella",     ar: "نوتيلا",      aliases: ["nutella","نوتيلا"] },
  { en: "M&M's",       ar: "ام اند ام",   aliases: ["m&m","m&ms","mm","ام اند ام","ام أند ام"] },
  { en: "Toblerone",   ar: "توبليرون",    aliases: ["toblerone","توبليرون"] },
  { en: "Maltesers",   ar: "مالتيزرز",    aliases: ["maltesers","مالتيزرز"] },

  // Biscuits / wafers
  { en: "Oreo",        ar: "أوريو",       aliases: ["oreo","أوريو","اوريو"] },
  { en: "Tiger",       ar: "تايجر",       aliases: ["tiger biscuit","tiger choco"] },
  { en: "Tuc",         ar: "توك",         aliases: ["tuc","توك"] },
  { en: "Loacker",     ar: "لواكر",       aliases: ["loacker","لواكر"] },
  { en: "Khalifa",     ar: "خليفة",       aliases: ["khalifa","خليفة","خليفه"] },
  { en: "Saiwa",       ar: "صيوا",        aliases: ["saiwa","صيوا"] },
  { en: "Belgi",       ar: "بلجي",        aliases: ["belgi","بلجي"] },

  // Dairy
  { en: "Lurpak",      ar: "لورباك",      aliases: ["lurpak","لورباك"] },
  { en: "President",   ar: "بريزيدنت",    aliases: ["president","بريزيدنت"] },
  { en: "Puck",        ar: "بوك",         aliases: ["puck","بوك"] },
  { en: "Hammoudeh",   ar: "حمودة",       aliases: ["hammoudeh","hamoudeh","حمودة","حموده"] },
  { en: "Al Juneidi",  ar: "الجنيدي",     aliases: ["al juneidi","aljuneidi","الجنيدي"] },
  { en: "Anchor",      ar: "أنكور",       aliases: ["anchor butter","anchor","أنكور","انكور"] },

  // Coffee / tea
  { en: "Nescafe",     ar: "نسكافيه",     aliases: ["nescafe","nescafé","نسكافيه","نسكافه"] },
  { en: "Lipton",      ar: "ليبتون",      aliases: ["lipton","ليبتون"] },
  { en: "Twinings",    ar: "توينيغز",     aliases: ["twinings","توينيغز"] },
  { en: "Najjar",      ar: "النجار",      aliases: ["najjar","النجار","نجار"] },
  { en: "Karmout",     ar: "قرموط",       aliases: ["karmout","قرموط"] },
  { en: "Al Ameed",    ar: "العميد",      aliases: ["al ameed","العميد"] },

  // Cigarettes
  { en: "Marlboro",    ar: "مارلبورو",    aliases: ["marlboro","مارلبورو"] },
  { en: "L&M",         ar: "ال اند ام",   aliases: ["l&m","lm","ال اند ام"] },
  { en: "Davidoff",    ar: "دافيدوف",     aliases: ["davidoff","دافيدوف"] },
  { en: "Winston",     ar: "وينستون",     aliases: ["winston","وينستون"] },
  { en: "Camel",       ar: "كامل",        aliases: ["camel cigarette","camel","كامل سجائر"] },
  { en: "Gauloises",   ar: "جلواز",       aliases: ["gauloises","جلواز"] },
  { en: "Viceroy",     ar: "فايسروي",     aliases: ["viceroy","فايسروي"] },

  // Care / household
  { en: "Pampers",     ar: "بامبرز",      aliases: ["pampers","بامبرز","بمبرز"] },
  { en: "Huggies",     ar: "هاجيز",       aliases: ["huggies","هاجيز"] },
  { en: "Always",      ar: "أولويز",      aliases: ["always","أولويز","اولويز"] },
  { en: "Colgate",     ar: "كولجيت",      aliases: ["colgate","كولجيت"] },
  { en: "Sensodyne",   ar: "سنسوداين",    aliases: ["sensodyne","سنسوداين"] },
  { en: "Signal",      ar: "سيجنال",      aliases: ["signal","سيجنال","سيقنال"] },
  { en: "Head & Shoulders", ar: "هيد اند شولدرز", aliases: ["head & shoulders","head and shoulders","h&s","هيد اند شولدرز"] },
  { en: "Pantene",     ar: "بانتين",      aliases: ["pantene","بانتين"] },
  { en: "Dove",        ar: "دوف",         aliases: ["dove","دوف"] },
  { en: "Lifebuoy",    ar: "لايف بوي",    aliases: ["lifebuoy","لايف بوي","لايفبوي"] },
  { en: "Lux",         ar: "لوكس",        aliases: ["lux","لوكس"] },
  { en: "Dettol",      ar: "ديتول",       aliases: ["dettol","ديتول"] },
  { en: "Clorox",      ar: "كلوركس",      aliases: ["clorox","كلوركس","كلور"] },
  { en: "Ariel",       ar: "آريال",       aliases: ["ariel","آريال","اريال"] },
  { en: "Persil",      ar: "بيرسل",       aliases: ["persil","بيرسل"] },
  { en: "Tide",        ar: "تايد",        aliases: ["tide","تايد"] },
  { en: "Fairy",       ar: "فيري",        aliases: ["fairy","فيري"] },
  { en: "Finish",      ar: "فنيش",        aliases: ["finish","فنيش"] }
];

// Pre-compute lowercased alias index for fast lookup
const _brandIndex = (() => {
  const arr = [];
  BRANDS.forEach(b => {
    b.aliases.forEach(a => {
      arr.push({ alias: a.toLowerCase().trim(), brand: b });
    });
  });
  // Sort longest first so multi-word aliases match before partials
  arr.sort((x, y) => y.alias.length - x.alias.length);
  return arr;
})();

// ═══ FLAVOR / PRODUCT DICTIONARY ═══════════════════════════════════════════
// Bidirectional translation map for the descriptive part of the name (after brand).

export const FLAVORS = [
  // Cola variants
  { en: "Cola",          ar: "كولا",        keys: ["cola","cola classic","regular","كولا","كولا عادي"] },
  { en: "Cola Zero",     ar: "كولا زيرو",   keys: ["cola zero","zero","diet cola","كولا زيرو","زيرو","دايت كولا"] },
  { en: "Cola Light",    ar: "كولا لايت",   keys: ["cola light","light","لايت","كولا لايت"] },
  { en: "Cola Up",       ar: "كولا اب",     keys: ["cola up","kola up","كولا اب","كولا أب"] },
  { en: "Cola Up Zero",  ar: "كولا اب زيرو",keys: ["cola up zero","kola up zero","كولا اب زيرو"] },
  { en: "7Up",           ar: "سفن اب",      keys: ["7up","seven up","up","سفن اب","سفن أب"] },
  { en: "7Up Zero",      ar: "سفن اب زيرو", keys: ["7up zero","seven up zero","up zero","سفن اب زيرو","سفن زيرو"] },

  // Fruits / flavors
  { en: "Orange",        ar: "برتقال",      keys: ["orange","برتقال","برتقالة"] },
  { en: "Lemon",          ar: "ليمون",       keys: ["lemon","lemonade","ليمون","ليمونادة"] },
  { en: "Apple",          ar: "تفاح",        keys: ["apple","تفاح","تفاحة"] },
  { en: "Strawberry",     ar: "فراولة",      keys: ["strawberry","فراولة","فروالة"] },
  { en: "Mango",          ar: "مانجو",       keys: ["mango","مانجو","مانجة"] },
  { en: "Peach",          ar: "خوخ",         keys: ["peach","خوخ"] },
  { en: "Pineapple",      ar: "أناناس",      keys: ["pineapple","أناناس","اناناس"] },
  { en: "Grape",          ar: "عنب",         keys: ["grape","عنب"] },
  { en: "Cherry",         ar: "كرز",         keys: ["cherry","كرز"] },
  { en: "Banana",         ar: "موز",         keys: ["banana","موز"] },
  { en: "Watermelon",     ar: "بطيخ",        keys: ["watermelon","بطيخ"] },
  { en: "Pomegranate",    ar: "رمان",        keys: ["pomegranate","رمان"] },
  { en: "Mixed Fruit",    ar: "فواكه",       keys: ["fruit","fruits","mixed fruit","tropical","فواكه","فواكة","فاكهة"] },
  { en: "Mint",           ar: "نعناع",       keys: ["mint","نعناع"] },
  { en: "Vanilla",        ar: "فانيلا",      keys: ["vanilla","فانيلا","فانيليا"] },
  { en: "Chocolate",      ar: "شوكولاتة",    keys: ["chocolate","choco","شوكولاتة","شوكولا","شيكولاتة"] },
  { en: "Caramel",        ar: "كراميل",      keys: ["caramel","كراميل"] },
  { en: "Hazelnut",       ar: "بندق",        keys: ["hazelnut","بندق"] },
  { en: "Coconut",        ar: "جوز هند",     keys: ["coconut","جوز هند","نارجيل"] },

  // Chips flavors
  { en: "Salt",           ar: "ملح",         keys: ["salt","salted","ملح","ملحة"] },
  { en: "Cheese",         ar: "جبنة",        keys: ["cheese","cheddar","جبنة","جبن"] },
  { en: "Sour Cream & Onion", ar: "كريمة حامضة وبصل", keys: ["sour cream","sour cream and onion","كريمة وبصل"] },
  { en: "BBQ",            ar: "باربكيو",     keys: ["bbq","barbecue","باربكيو","بي بي كيو"] },
  { en: "Ketchup",        ar: "كاتشب",       keys: ["ketchup","كاتشب","كاتشاب"] },
  { en: "Vinegar",        ar: "خل",          keys: ["salt and vinegar","vinegar","خل"] },
  { en: "Chili",          ar: "حار",         keys: ["chili","spicy","hot","حار","شطة","فلفل حار"] },
  { en: "Pizza",          ar: "بيتزا",       keys: ["pizza","بيتزا"] },

  // Dairy / breakfast
  { en: "Milk",           ar: "حليب",        keys: ["milk","whole milk","حليب","لبن"] },
  { en: "Yogurt",         ar: "لبن",         keys: ["yogurt","yoghurt","لبن","لبنة","لبن رايب"] },
  { en: "Butter",         ar: "زبدة",        keys: ["butter","زبدة"] },
  { en: "Cheese",         ar: "جبنة",        keys: ["cheese block","cheese slice"] },
  { en: "Cream",          ar: "كريمة",       keys: ["cream","قشطة","قشدة"] },

  // Water/water
  { en: "Pure Water",     ar: "مياه",        keys: ["water","pure water","mineral water","مياه","مية","ماء","مياه شرب"] },
  { en: "Sparkling Water",ar: "مياه فوارة",  keys: ["sparkling water","sparkling","soda water","مياه فوارة","مياه غازية"] }
];

const _flavorIndex = (() => {
  const map = new Map();
  FLAVORS.forEach(f => {
    f.keys.forEach(k => {
      map.set(k.toLowerCase().trim(), f);
    });
  });
  return map;
})();

// ═══ SIZE / VOLUME / WEIGHT REGEX ═══════════════════════════════════════════

// ═══ SIZE / VOLUME / WEIGHT REGEX ═══════════════════════════════════════════
// Note: \b doesn't work for Arabic letters in JavaScript regex, so we use
// explicit lookaheads for "end of token" — either end-of-string or a non-letter.

const _END = "(?![\\u0600-\\u06FFa-zA-Z])"; // assertion: next char is NOT a Latin/Arabic letter

const SIZE_PATTERNS = [
  // Combined size+pack: "6x250ml", "6 x 250 ml", "6×250مل"
  new RegExp(`(\\d+)\\s*[x×*]\\s*(\\d+(?:\\.\\d+)?)\\s*(ml|ML|مل|ملل|gm|g|gr|GR|GM|جم|غم|kg|KG|كغم|كيلو|ك\\.?غ|l|L|lt|LT|Lt|ltr|LTR|لتر|ليتر|جرام|غرام|كغ)${_END}`),
  // Single size: "330ml", "1.5L", "500 جم", "1 lt", "185 مل"
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(ml|ML|مل|ملل|gm|g|gr|GR|GM|جم|غم|kg|KG|كغم|كيلو|ك\\.?غ|l|L|lt|LT|Lt|ltr|LTR|لتر|ليتر|جرام|غرام|كغ)${_END}`)
];

const PACK_PATTERNS = [
  // "Pack of 6", "علبة 12", "كرتون 24"
  /(?:pack of|pkt of|علبة|عبوة|كرتون|بكت|باكيت)\s*(\d+)\s*(?:pcs|pieces|قطع|قطعة|حبة|حبات)?/i,
  // standalone count with unit word
  new RegExp(`(\\d+)\\s*(?:pcs|pc|pieces|قطعة|قطع|حبة|حبات|count|ct)${_END}`, "i"),
  // "x6" or "× 6" — only when preceded by separator/start
  /(?:^|\s)[x×]\s*(\d+)(?![0-9])/i
];

// Normalize unit to canonical form (en + ar)
function normalizeUnit(u) {
  const x = u.toLowerCase().trim();
  if (["ml","مل","ملل"].includes(x)) return { en: "ml",  ar: "مل" };
  if (["g","gm","gr","جم","غم","جرام","غرام"].includes(x)) return { en: "g",   ar: "جم" };
  if (["kg","كغم","كغ","كيلو","ك.غ","ك غ"].includes(x))   return { en: "kg",  ar: "كغم" };
  if (["l","lt","ltr","لتر","ليتر"].includes(x))           return { en: "L",   ar: "لتر" };
  return { en: x, ar: x };
}

// Format size for display: "300ml" / "300 مل" — for liters >= 1L use "1L"/"1 لتر"
function formatSize(value, unitNorm) {
  // Normalize ml >= 1000 → L conversion is optional; keep raw value for clarity unless exact 1000/2000
  const v = value;
  let displayV = (Math.round(v * 1000) / 1000);
  // Strip trailing .0 / .00
  displayV = String(displayV).replace(/\.0+$/, "");
  return {
    en: `${displayV}${unitNorm.en === "L" ? "L" : unitNorm.en}`,         // "330ml" / "1L"
    ar: `${displayV} ${unitNorm.ar}`                                       // "330 مل" / "1 لتر"
  };
}

// ═══ TOKENIZATION ═══════════════════════════════════════════════════════════

// Split a name into normalized tokens. Preserves original Arabic and English.
function tokenize(name) {
  if (!name) return [];
  let s = String(name)
    .replace(/[\u200E\u200F\u202A-\u202E\uFEFF]/g, "")     // remove BOM/RTL marks
    .replace(/[_\-/+,.|]/g, " ")                            // normalize separators
    .replace(/\s+/g, " ")
    .trim();
  return s.split(" ").filter(Boolean);
}

// ═══ EXTRACTION ═════════════════════════════════════════════════════════════

function extractBrand(name) {
  const lower = name.toLowerCase();
  let best = null;       // earliest position wins; ties broken by alias length
  for (const entry of _brandIndex) {
    const idx = lower.indexOf(entry.alias);
    if (idx === -1) continue;
    if (best === null || idx < best.position || (idx === best.position && entry.alias.length > best.matched.length)) {
      best = { brand: entry.brand, matched: entry.alias, position: idx };
    }
  }
  return best;
}

function extractSize(name) {
  for (const re of SIZE_PATTERNS) {
    const m = name.match(re);
    if (m) {
      // SIZE_PATTERNS[0] = pack×size form: m[1]=count, m[2]=value, m[3]=unit
      // SIZE_PATTERNS[1,2] = single size:    m[1]=value, m[2]=unit
      const isCombined = re === SIZE_PATTERNS[0];
      if (isCombined) {
        const unit = normalizeUnit(m[3]);
        return { value: parseFloat(m[2]), unitEn: unit.en, unitAr: unit.ar, packCount: parseInt(m[1], 10), raw: m[0] };
      } else {
        const unit = normalizeUnit(m[2]);
        return { value: parseFloat(m[1]), unitEn: unit.en, unitAr: unit.ar, packCount: null, raw: m[0] };
      }
    }
  }
  return null;
}

function extractPackCount(name, alreadyHavePack) {
  if (alreadyHavePack) return null;
  for (const re of PACK_PATTERNS) {
    const m = name.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 2 && n <= 1000) return n; // sanity bounds
    }
  }
  return null;
}

// Translate Arabic numeral string to Western and back
function arabicToWestern(s) {
  return String(s).replace(/[٠-٩]/g, d => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}

// After removing brand+size+pack, what's left is the flavor/product description.
// Match it against the FLAVOR dictionary.
function extractFlavor(remaining) {
  if (!remaining || remaining.trim().length === 0) return null;
  const lower = remaining.toLowerCase().trim();
  const tokens = lower.split(/\s+/);

  // Collect all matches (multi-word preferred over single-word, then rightmost wins)
  const matches = [];
  for (let len = tokens.length; len >= 1; len--) {
    for (let start = 0; start + len <= tokens.length; start++) {
      const candidate = tokens.slice(start, start + len).join(" ");
      if (_flavorIndex.has(candidate)) {
        matches.push({ flavor: _flavorIndex.get(candidate), matched: candidate, start, len });
      }
    }
    // If a multi-word match is found, prefer it (don't fall through to single-word)
    if (matches.length > 0 && len > 1) break;
  }

  if (matches.length === 0) return null;

  // Pick the rightmost (most specific) — for "milk chocolate", "chocolate" usually wins
  matches.sort((a, b) => (b.start + b.len) - (a.start + a.len));
  return { flavor: matches[0].flavor, matched: matches[0].matched };
}

// Strip ALL recognized brand aliases from a string (used to clean leftover text
// before flavor extraction so "Mirinda Matrix" doesn't keep "Matrix" as flavor).
function stripAllBrands(s) {
  if (!s) return s;
  let out = s;
  for (const entry of _brandIndex) {
    out = out.replace(new RegExp(entry.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }
  return out.replace(/\s+/g, " ").trim();
}

// ═══ MAIN: SUGGEST UNIFIED NAME ════════════════════════════════════════════

/**
 * Given a product (name, name_ar, barcode, category), return a suggested
 * unified name in both languages plus a confidence score.
 *
 * Returns: {
 *   suggestedEn, suggestedAr,
 *   confidence: "high" | "medium" | "low" | "review",
 *   parts: { brand, flavor, size, pack },
 *   notes: string[]  // human-readable explanation
 * }
 */
export function suggestUnifiedName(product) {
  // Convert Arabic numerals → Western so size regex matches both
  const en = arabicToWestern(product.name || "");
  const ar = arabicToWestern(product.name_ar || "");
  const combined = (en + " " + ar).trim();

  const notes = [];
  const parts = { brand: null, flavor: null, size: null, pack: null };

  // 1) Brand (earliest match wins → "ميرندا ماتركس" picks Mirinda, not Matrix)
  const brandHit = extractBrand(combined);
  if (brandHit) {
    parts.brand = brandHit.brand;
  } else {
    notes.push("لم يُتعرف على العلامة التجارية");
  }

  // 2) Size — search both langs separately so we can strip from each
  const sizeHitEn = extractSize(en);
  const sizeHitAr = extractSize(ar);
  const sizeHit = sizeHitEn || sizeHitAr;
  if (sizeHit) {
    parts.size = sizeHit;
    if (sizeHit.packCount) parts.pack = sizeHit.packCount;
  } else {
    notes.push("لم يُتعرف على الحجم/الكمية");
  }

  // 3) Pack count (independent regex if not already from size)
  if (!parts.pack) {
    const packHit = extractPackCount(combined, false);
    if (packHit) parts.pack = packHit;
  }

  // 4) Flavor — strip brand alias and size raw from EACH language separately
  let leftoverEn = en;
  let leftoverAr = ar;
  if (brandHit) {
    const escAlias = brandHit.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escEn    = brandHit.brand.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escAr    = brandHit.brand.ar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    leftoverEn = leftoverEn.replace(new RegExp(escAlias, "gi"), "")
                            .replace(new RegExp(escEn, "gi"), "")
                            .replace(new RegExp(escAr, "gi"), "");
    leftoverAr = leftoverAr.replace(new RegExp(escAlias, "gi"), "")
                            .replace(new RegExp(escEn, "gi"), "")
                            .replace(new RegExp(escAr, "gi"), "");
  }
  if (sizeHitEn && sizeHitEn.raw) {
    const r = new RegExp(sizeHitEn.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    leftoverEn = leftoverEn.replace(r, "");
  }
  if (sizeHitAr && sizeHitAr.raw) {
    const r = new RegExp(sizeHitAr.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    leftoverAr = leftoverAr.replace(r, "");
  }
  // Strip any pack hint
  PACK_PATTERNS.forEach(p => {
    leftoverEn = leftoverEn.replace(new RegExp(p.source, p.flags), "");
    leftoverAr = leftoverAr.replace(new RegExp(p.source, p.flags), "");
  });
  // Strip any OTHER brand mentions left in leftover (handles "Mirinda Matrix" type)
  leftoverEn = stripAllBrands(leftoverEn);
  leftoverAr = stripAllBrands(leftoverAr);
  // Strip generic noise words that aren't useful
  const NOISE = ["حجم","صغير","كبير","متوسط","حبة","حبه","drink","beverage","new","old","original","classic","عادي","عاديه"];
  NOISE.forEach(w => {
    leftoverEn = leftoverEn.replace(new RegExp(`\\b${w}\\b`, "gi"), "");
    leftoverAr = leftoverAr.replace(new RegExp(w, "g"), "");
  });
  // Strip stray separators left after removals
  leftoverEn = leftoverEn.replace(/[\-_/+,.|]+/g, " ").replace(/\s+/g, " ").trim();
  leftoverAr = leftoverAr.replace(/[\-_/+,.|]+/g, " ").replace(/\s+/g, " ").trim();

  // Try flavor against each language separately, prefer the one with a hit
  const flavorEn = extractFlavor(leftoverEn);
  const flavorAr = extractFlavor(leftoverAr);
  parts.flavor = flavorEn || flavorAr;
  if (!parts.flavor && (leftoverEn || leftoverAr)) {
    notes.push("لم يُتعرف على النكهة/الوصف — استُخدم النص الباقي كما هو");
  }

  // 5) Build final name
  const sizeFmt = parts.size ? formatSize(parts.size.value, { en: parts.size.unitEn, ar: parts.size.unitAr }) : null;
  const packStr = parts.pack ? { en: ` (${parts.pack} pcs)`, ar: ` (${arabicNumerals(parts.pack)} قطع)` } : { en: "", ar: "" };

  const flavorEnStr = parts.flavor ? parts.flavor.flavor.en : leftoverEn;
  const flavorArStr = parts.flavor ? parts.flavor.flavor.ar : leftoverAr;

  const brandEn = parts.brand ? parts.brand.en : "";
  const brandAr = parts.brand ? parts.brand.ar : "";

  let suggestedEn = [brandEn, flavorEnStr, sizeFmt ? sizeFmt.en : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() + packStr.en;
  let suggestedAr = [brandAr, flavorArStr, sizeFmt ? sizeFmt.ar : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() + packStr.ar;

  suggestedEn = suggestedEn.trim();
  suggestedAr = suggestedAr.trim();

  // 6) Confidence
  let score = 0;
  if (parts.brand)   score += 40;
  if (parts.size)    score += 35;
  if (parts.flavor)  score += 25;
  if (!parts.flavor && (leftoverEn.length > 12 || leftoverAr.length > 12)) score -= 15;

  let confidence;
  if (score >= 90)      confidence = "high";
  else if (score >= 65) confidence = "medium";
  else if (score >= 40) confidence = "low";
  else                  confidence = "review";

  return {
    suggestedEn: suggestedEn || product.name || "",
    suggestedAr: suggestedAr || product.name_ar || "",
    confidence,
    score,
    parts,
    notes
  };
}

function arabicNumerals(n) {
  return String(n).replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[parseInt(d, 10)]);
}

// ═══ HELPERS FOR THE UI ═════════════════════════════════════════════════════

// Returns true if current name already matches the suggested one (no change needed)
export function isAlreadyClean(product, suggestion) {
  const n  = (product.name || "").trim();
  const na = (product.name_ar || "").trim();
  return n === suggestion.suggestedEn && na === suggestion.suggestedAr;
}

// Diff helper: returns array of changed fields
export function diffFields(product, suggestion) {
  const changed = [];
  if ((product.name || "").trim()    !== suggestion.suggestedEn) changed.push("en");
  if ((product.name_ar || "").trim() !== suggestion.suggestedAr) changed.push("ar");
  return changed;
}

// Statistics
export function summarizeSuggestions(items) {
  const stats = { total: items.length, high: 0, medium: 0, low: 0, review: 0, noChange: 0, willChange: 0 };
  items.forEach(it => {
    stats[it.suggestion.confidence] += 1;
    if (it.changed.length === 0) stats.noChange += 1;
    else stats.willChange += 1;
  });
  return stats;
}

// Confidence label and color for UI (consumer chooses Arabic/English)
export function confidenceLabel(c, lang) {
  const ar = lang === "ar";
  switch (c) {
    case "high":   return ar ? "ثقة عالية"   : "High";
    case "medium": return ar ? "ثقة متوسطة"  : "Medium";
    case "low":    return ar ? "ثقة منخفضة"  : "Low";
    case "review": return ar ? "يحتاج مراجعة" : "Review";
    default: return c;
  }
}

export function confidenceColor(c) {
  switch (c) {
    case "high":   return { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0" };
    case "medium": return { bg: "#fffbeb", fg: "#92400e", border: "#fcd34d" };
    case "low":    return { bg: "#fef3c7", fg: "#854d0e", border: "#fde68a" };
    case "review": return { bg: "#fef2f2", fg: "#991b1b", border: "#fca5a5" };
    default:       return { bg: "#f3f4f6", fg: "#374151", border: "#d1d5db" };
  }
}
